#!/usr/bin/env node

/**
 * Module dependencies.
 */
const Scraper = require("./scraper");
var program = require("commander");
var inquirer = require("inquirer");
var _progress = require("cli-progress");
var colors = require("colors");
const jsonfile = require("jsonfile");

var fs = require("fs"),
  Log = require("log"),
  log = new Log("debug", fs.createWriteStream(`log.log`));

program
  .version("0.0.1")
  .description("Bundestag scraper")
  .option(
    "-p, --period [PeriodenNummer|Alle]",
    "Select a specified period [null]",
    null
  )
  .option(
    "-t, --operationtypes <OperationTypeNummer|Alle>",
    "Select specified OperationTypes [null]",
    null
  )
  .parse(process.argv);

const scraper = new Scraper();

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrape() {
  await scraper.init();
  const stack = await Promise.all(scraper.createBrowserStack(7));
  // console.log(stack);
  await scraper.start();
  await scraper.goToSearch();

  //Select Period
  const periods = await scraper.takePeriods();
  var selectedPeriod = program.period;
  if (!selectedPeriod) {
    const period = await inquirer.prompt({
      type: "list",
      name: "value",
      message: "Wähle eine Legislaturperiode",
      choices: periods
    });
    selectedPeriod = period.value;
  } else if (
    !periods.find(function(period) {
      return period.name === selectedPeriod;
    })
  ) {
    console.log(`'${selectedPeriod}' is not a valid option for period`);
    process.exit(1);
  }
  console.log(`Selected Period '${selectedPeriod}'`);
  await scraper.selectPeriod(selectedPeriod);

  //Select operationTypes
  const operationTypes = await scraper.takeOperationTypes();
  var selectedOperationTypes = [];
  if (!program.operationtypes) {
    const operationType = await inquirer.prompt({
      type: "checkbox",
      name: "values",
      message: "Wähle Vorgangstyp(en)",
      choices: operationTypes
    });
    selectedOperationTypes = operationType.values;
  } else {
    const selectedOperationTypes_proto = program.operationtypes.split(",");
    for (var i = 0, iLen = selectedOperationTypes_proto.length; i < iLen; i++) {
      operationTypes.find(function(ot) {
        if (selectedOperationTypes_proto[i] === "Alle" || ot.name.substring(0, 3) === selectedOperationTypes_proto[i]) {
          selectedOperationTypes.push(ot.value);
        }
      });
    }
    if (selectedOperationTypes.length === -1) {
      console.log(
        `'${selectedOperationTypes_proto}' is not a valid option for OperationTypes`
      );
      process.exit(1);
    }
  }
  console.log(`Selected OperationTypes '${selectedOperationTypes}'`);
  await scraper.selectOperationTypes(selectedOperationTypes);

  //Search
  const resultsInfo = await scraper.search();
  let links = await scraper.getEntriesFromSearch(resultsInfo);
  console.log("Einträge downloaden");
  var bar1 = new _progress.Bar(
    {
      format:
        "[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total} | {errorCounter}"
    },
    _progress.Presets.shades_classic
  );
  bar1.start(resultsInfo.entriesSum, 0, {
    errorCounter: stack.map(
      ({ errorCount }) => (errorCount < 1 ? errorCount : `${errorCount}`.red)
    )
  });

  let completedLinks = 0;

  const analyseLink = async (link, browser) => {
    await scraper.saveJson(link.url, browser.page).then(() => {
      //console.log("success");
      completedLinks += 1;
      bar1.update(completedLinks, {
        errorCounter: stack.map(
          ({ errorCount }) =>
            errorCount < 1 ? errorCount : `${errorCount}`.red
        )
      });
    });
  };

  const startAnalyse = async browserIndex => {
    const linkIndex = links.findIndex(({ scraped }) => !scraped);
    if (linkIndex !== -1) {
      links[linkIndex].scraped = true;
      await analyseLink(links[linkIndex], stack[browserIndex])
        .then(() => {
          jsonfile.writeFile(
            `links-${period.value}-${operationType.values}.json`,
            links,
            {
              spaces: 2,
              EOL: "\r\n"
            },
            err => {}
          );
        })
        .catch(async err => {
          log.error(err);
          stack[browserIndex].errorCount += 1;
          links[linkIndex].scraped = false;
          if (stack[browserIndex].errorCount > 5) {
            await scraper
              .createNewBrowser(stack[browserIndex])
              .then(newBrowser => {
                stack[browserIndex] = newBrowser;
                bar1.update(completedLinks, {
                  errorCounter: stack.map(
                    ({ errorCount }) =>
                      errorCount < 1 ? errorCount : `${errorCount}`.red
                  )
                });
              })
              .catch(err => log.error(err));
          }
        });
      await startAnalyse(browserIndex);
    }
  };

  const promises = stack.map(async (browser, browserIndex) => {
    await startAnalyse(browserIndex);
  });
  await Promise.all(promises).then(() => {
    stack.forEach(b => b.browser.close());
    bar1.stop();
    scraper.finish();
  });

  console.log("############### FINISH ###############");
}

try {
  scrape();
} catch (error) {
  console.error(error);
}
