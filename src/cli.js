#!/usr/bin/env node

/**
 * Module dependencies.
 */
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

async function selectPeriod(periods) {
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
}

async function selectOperationTypes(operationTypes) {
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
}

async function finished() {
  console.log('############### FINISH ###############');
}

const barLink = new Progress.Bar(
  {
    format:
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total}',
  },
  Progress.Presets.shades_classic,
);

async function startLinkProgress(sum, current) {
  console.log('Eintragslinks sammeln');

  barLink.start(sum, current);
}

async function updateLinkProgress(current) {
  barLink.update(current);
}

async function stopLinkProgress() {
  barLink.stop();
}

const barData = new Progress.Bar(
  {
    format:
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total} | {errorCounter}',
  },
  Progress.Presets.shades_classic,
);

async function startDataProgress(sum, errorCounter) {
  console.log('Einträge downloaden');
  barData.start(sum, 0, errorCounter);
}

async function updateDataProgress(current, errorCounter) {
  barData.update(current, errorCounter);
}

async function stopDataProgress() {
  barData.stop();
}

async function logLinks(links) {
  jsonfile.writeFile(
    `links-${program.period}-${program.operationtypes}.json`,
    links,
    {
      spaces: 2,
      EOL: '\r\n',
    },
    (/* err */) => {},
  );
}

async function logData(process, processData) {
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
}

function doScrape(/* { id, url, date } */) {
  // console.log(id, url, date);
  // return Math.random() >= 0.5;
  return true;
}

try {
  scraper.scrape({
    selectedPeriod: selectPeriod,
    selectedOperationTypes: selectOperationTypes,
    startLinkProgress,
    updateLinkProgress,
    stopLinkProgress,
    startDataProgress,
    updateDataProgress,
    stopDataProgress,
    finished,
    logLinks,
    logData,
    doScrape, // todo -> call before analysing link, abort if false
    stackSize: 7,
  });
} catch (error) {
  console.error(error);
}
