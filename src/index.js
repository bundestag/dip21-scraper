#!/usr/bin/env node

/**
 * Module dependencies.
 */
const Scraper = require("./scraper");
var program = require("commander");
var inquirer = require("inquirer");
var _progress = require("cli-progress");

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
  while (
    links.filter(({ scraped }) => !scraped).length > 0 ||
    stack.find(b => b.used)
  ) {
    let linkIndex = links.findIndex(({ scraped }) => !scraped);
    let freeBrowserIndex = stack.findIndex(b => !b.used);
    let freeBrowser = stack[freeBrowserIndex];
    if (freeBrowser) {
      try {
        if (links[linkIndex]) {
          links[linkIndex].scraped = true;
          freeBrowser.used = true;
          scraper
            .saveJson(links[linkIndex].url, linkIndex, freeBrowser.page)
            .then(() => {
              //console.log("success");
              freeBrowser.used = false;
              bar1.update(
                resultsInfo.entriesSum -
                  links.filter(({ scraped }) => !scraped).length
              );
            })
            .catch(err => {
              links[linkIndex].scraped = false;
              // console.log("################################");
              // console.log(err);
              freeBrowser.errorCount += 1;
              // console.log("errorCount: ", freeBrowser.errorCount);
              if (freeBrowser.errorCount >= 3) {
                scraper
                  .createNewBrowser(freeBrowser)
                  .then(newBrowser => {
                    stack[freeBrowserIndex] = newBrowser;
                    // console.log(stack.map(br => br.used));
                  })
                  .catch(err => console.log(err));
              } else {
                freeBrowser.used = false;
              }
            });
        }
      } catch (error) {
        console.log(error);
      }
    }
    await timeout(30);
  }
  stack.forEach(b => b.browser.close());
  bar1.stop();
  await scraper.finish();
}

try {
  scrape();
} catch (error) {
  console.error(error);
}
