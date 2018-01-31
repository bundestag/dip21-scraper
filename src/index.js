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

async function scrape() {
  await scraper.init();
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
  var bar1 = new _progress.Bar({}, _progress.Presets.shades_classic);
  bar1.start(resultsInfo.entriesSum, 0);
  while (links.filter(({ scraped }) => !scraped).length > 0) {
    let linkIndex = links.findIndex(({ scraped }) => !scraped);
    if (links[linkIndex]) {
      try {
        await scraper.saveJson(links[linkIndex].url, linkIndex);
        links[linkIndex].scraped = true;
      } catch (error) {}
    }
    bar1.update(
      resultsInfo.entriesSum - links.filter(({ scraped }) => !scraped).length
    );
  }

  bar1.stop();
  await scraper.finish();
}

try {
  scrape();
} catch (error) {
  console.error(error);
}
