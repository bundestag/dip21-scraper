#!/usr/bin/env node

/**
 * Module dependencies.
 */
const Scraper = require("./scraper");
var program = require("commander");
var inquirer = require("inquirer");
var _progress = require("cli-progress");
const eachLimit = require("async").eachLimit;

program.version("0.0.1").description("Bundestag scraper");
program.parse(process.argv);

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
  const periods = await scraper.takePeriods();
  const period = await inquirer.prompt({
    type: "list",
    name: "value",
    message: "Wähle eine Legislaturperiode",
    choices: periods
  });
  await scraper.selectPeriod(period.value);
  const operationTypes = await scraper.takeOperationTypes();
  const operationType = await inquirer.prompt({
    type: "checkbox",
    name: "values",
    message: "Wähle Vorgangstyp(en)",
    choices: operationTypes
  });
  await scraper.selectOperationTypes(operationType.values);
  const resultsInfo = await scraper.search();
  let links = await scraper.getEntriesFromSearch(resultsInfo);
  console.log("Einträge downloaden");
  var bar1 = new _progress.Bar(
    {
      format:
        "[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total}"
    },
    _progress.Presets.shades_classic
  );
  bar1.start(resultsInfo.entriesSum, 0);

  let completedLinks = 0;

  const analyseLink = async (link, browser) => {
    await scraper.saveJson(link.url, browser.page).then(() => {
      //console.log("success");
      completedLinks += 1;
      bar1.update(completedLinks);
    });
  };

  const startAnalyse = async browserIndex => {
    const linkIndex = links.findIndex(({ scraped }) => !scraped);
    if (linkIndex !== -1) {
      links[linkIndex].scraped = true;
      await analyseLink(links[linkIndex], stack[browserIndex]).catch(
        async err => {
          stack[browserIndex].errorCount += 1;
          links[linkIndex].scraped = false;
          await scraper
            .createNewBrowser(stack[browserIndex])
            .then(newBrowser => {
              stack[browserIndex] = newBrowser;
            })
            .catch(err => console.log(err));
        }
      );
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
