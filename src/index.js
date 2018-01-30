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
  await scraper.screenshot();
  const operationTypes = await scraper.takeOperationTypes();
  const operationType = await inquirer.prompt({
    type: "checkbox",
    name: "values",
    message: "Wähle Vorgangstyp(en)",
    choices: operationTypes
  });
  await scraper.selectOperationTypes(operationType.values);
  const resultCount = await scraper.search();
  await scraper.selectFirstEntry();

  var bar1 = new _progress.Bar({}, _progress.Presets.shades_classic);
  bar1.start(resultCount, 0);
  for (i = 1; i <= resultCount; i++) {
    await scraper.saveJson();

    //console.log(i);
    bar1.update(i);
    if (i < resultCount) {
      await scraper.goToNextEntry();
    } else {
      bar1.stop();
    }
  }
  await scraper.finish();
}

try {
  scrape();
} catch (error) {
  console.error(error);
}
