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
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total} | {retries}/{maxRetries}',
  },
  Progress.Presets.shades_classic,
);

const selectPeriod = async ({ periods }) => {
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

const selectOperationTypes = async ({ operationTypes }) => {
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

const logStartLinkProgress = async ({ sum, value }) => {
  console.log('Eintragslinks sammeln');

  barLink.start(sum, value);
};

const logUpdateLinkProgress = async ({ value }) => {
  barLink.update(value);
};

const logStopLinkProgress = async () => {
  barLink.stop();
};

const logStartDataProgress = async ({ sum, retries, maxRetries }) => {
  console.log('Einträge downloaden');
  barData.start(sum, 0, { retries, maxRetries });
};

const logUpdateDataProgress = async ({ value, retries, maxRetries }) => {
  barData.update(value, { retries, maxRetries });
};

const logStopDataProgress = async () => {
  barData.stop();
};

const logError = ({ error }) => {
  console.log(error);
};

const outScraperLinks = async ({ links }) => {
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

const outScraperData = async ({ procedure, procedureData }) => {
  const directory = `files/${procedureData.VORGANG.WAHLPERIODE}/${
    procedureData.VORGANG.VORGANGSTYP
  }`;
  await fs.ensureDir(directory);
  jsonfile.writeFile(
    `${directory}/${procedure}.json`,
    procedureData,
    {
      spaces: 2,
      EOL: '\r\n',
    },
    (/* err */) => {},
  );
};

const logFatalError = ({ error }) => {
  console.log(`Fatal: ${error}`);
};

// HANDLE EXIT
// so the program will not close instantly
// process.stdin.resume();
// do something when app is closing
// process.on('exit', scraper.finalize.bind(scraper));
// process.on('SIGINT', scraper.finalize.bind(scraper));
// catches "kill pid" (for example: nodemon restart)
// process.on('SIGUSR1', scraper.finalize.bind(scraper));
// process.on('SIGUSR2', scraper.finalize.bind(scraper));
// catches uncaught exceptions
// process.on('uncaughtException', scraper.finalize.bind(scraper));

scraper
  .scrape({
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
    logFatalError,
    outScraperLinks,
    outScraperData,
    browserStackSize: () => 7,
  })
  .catch((error) => {
    console.error(error);
  });
