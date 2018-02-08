#!/usr/bin/env node

const Scraper = require('./scraper');
const program = require('commander');
const inquirer = require('inquirer');
const Progress = require('cli-progress');
const jsonfile = require('jsonfile');
const fs = require('fs-extra');

program
  .version('0.0.1')
  .description('Bundestag scraper')
  .option('-p, --period [PeriodenNummer|Alle]', 'Select a specified period [null]', null)
  .option(
    '-t, --operationtypes <OperationTypeNummer|Alle>',
    'Select specified OperationTypes [null]',
    null,
  )
  .parse(process.argv);

const scraper = new Scraper();
const barLink = new Progress.Bar(
  {
    format:
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total}',
  },
  Progress.Presets.shades_classic,
);
const barData = new Progress.Bar(
  {
    format:
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total} | {errorCounter}',
  },
  Progress.Presets.shades_classic,
);

const selectPeriod = async (periods) => {
  let selectedPeriod = program.period;
  if (!selectedPeriod) {
    const period = await inquirer.prompt({
      type: 'list',
      name: 'value',
      message: 'Wähle eine Legislaturperiode',
      choices: periods,
    });
    selectedPeriod = period.value;
  } else if (!periods.find(period => period.name === selectedPeriod)) {
    console.log(`'${selectedPeriod}' is not a valid option for period`);
    process.exit(1);
  }
  if (selectedPeriod === 'Alle') {
    selectedPeriod = '';
  }
  console.log(`Selected Period '${selectedPeriod}'`);
  return selectedPeriod;
};

const selectOperationTypes = async (operationTypes) => {
  let selectedOperationTypes = [];
  if (!program.operationtypes) {
    const operationType = await inquirer.prompt({
      type: 'checkbox',
      name: 'values',
      message: 'Wähle Vorgangstyp(en)',
      choices: operationTypes,
    });
    selectedOperationTypes = operationType.values;
  } else {
    const selectedOperationTypesProto = program.operationtypes.split(',');
    selectedOperationTypes = selectedOperationTypesProto
      .map((sNumber) => {
        const selection = operationTypes.find(({ number }) => number === sNumber);
        if (selection) {
          return selection.value;
        }
        return undefined;
      })
      .filter(v => v !== undefined);
  }
  return selectedOperationTypes;
};

const logFinished = async () => {
  console.log('############### FINISH ###############');
};

const logStartLinkProgress = async (sum, current) => {
  console.log('Eintragslinks sammeln');

  barLink.start(sum, current);
};

const logUpdateLinkProgress = async (current) => {
  barLink.update(current);
};

const logStopLinkProgress = async () => {
  barLink.stop();
};

const logStartDataProgress = async (sum, errorCounter) => {
  console.log('Einträge downloaden');
  barData.start(sum, 0, errorCounter);
};

const logUpdateDataProgress = async (current, errorCounter) => {
  barData.update(current, errorCounter);
};

const logStopDataProgress = async () => {
  barData.stop();
};

const logError = (error) => {
  console.log(error);
};

const outScraperLinks = async (links) => {
  jsonfile.writeFile(
    `links-${program.period}-${program.operationtypes}.json`,
    links,
    {
      spaces: 2,
      EOL: '\r\n',
    },
    (/* err */) => {},
  );
};

const outScraperData = async (process, processData) => {
  const directory = `files/${processData.VORGANG.WAHLPERIODE}/${processData.VORGANG.VORGANGSTYP}`;
  await fs.ensureDir(directory);
  jsonfile.writeFile(
    `${directory}/${process}.json`,
    processData,
    {
      spaces: 2,
      EOL: '\r\n',
    },
    (/* err */) => {},
  );
};

const doScrape = () => true;

try {
  scraper.scrape({
    selectPeriod,
    selectOperationTypes,
    logStartLinkProgress,
    logUpdateLinkProgress,
    logStopLinkProgress,
    logStartDataProgress,
    logUpdateDataProgress,
    logStopDataProgress,
    logFinished,
    logError,
    outScraperLinks,
    outScraperData,
    doScrape,
    browserStackSize: () => 7,
  });
} catch (error) {
  console.error(error);
}
