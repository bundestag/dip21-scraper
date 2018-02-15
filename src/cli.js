#!/usr/bin/env node

const Scraper = require('./scraper');
const program = require('commander');
const inquirer = require('inquirer');
const Progress = require('cli-progress');
const jsonfile = require('jsonfile');
const fs = require('fs-extra');
const ProgressBar = require('ascii-progress');
const _ = require('lodash');
const prettyMs = require('pretty-ms');
// const readline = require('readline');

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

let bar1;
let bar2;
let bar3;

const barSearchPages = new Progress.Bar(
  {
    format:
      '[{bar}] {percentage}% | ETA: {eta_formatted} | duration: {duration_formatted} | {value}/{total}',
  },
  Progress.Presets.shades_classic,
);
const barSearchInstances = new Progress.Bar(
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

const selectPeriods = async ({ periods }) => {
  let selectedPeriod = program.period;
  if (!selectedPeriod) {
    const period = await inquirer.prompt({
      type: 'checkbox',
      name: 'values',
      message: 'Wähle eine Legislaturperiode',
      choices: periods,
    });
    selectedPeriod = period.values
      .map((v) => {
        const selection = periods.find(({ value }) => value === v);
        if (selection) {
          return selection.name;
        }
        return undefined;
      })
      .filter(v => v !== undefined);
    return selectedPeriod;
  } else if (!periods.find(period => period.name === selectedPeriod)) {
    console.log(`'${selectedPeriod}' is not a valid option for period`);
    process.exit(1);
  }
  console.log(`Selected Period '${selectedPeriod}'`);
  return periods.find(period => period.name === selectedPeriod).name;
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
    selectedOperationTypes = operationType.values
      .map((v) => {
        const selection = operationTypes.find(({ value }) => value === v);
        if (selection) {
          return selection.number;
        }
        return undefined;
      })
      .filter(v => v !== undefined);
  } else {
    selectedOperationTypes = program.operationtypes.split(',');
  }
  return selectedOperationTypes;
};

const logFinished = async () => {
  console.log('############### FINISH ###############');
};

const logStartLinkProgress = async ({ search }) => {
  console.log('Eintragslinks sammeln');
  // barSearchPages.start(search.pages.sum, search.pages.completed);
  // barSearchInstances.start(search.instances.sum, search.instances.completed);
  bar1 = new ProgressBar({
    schema: 'filters [:bar] :percent :completed/:sum | :eta | :elapsed sec',
  });
  bar2 = new ProgressBar({
    schema: 'pages [:bar] :percent :completed/:sum | :eta | :elapsed sec',
  });
};

const logUpdateLinkProgress = async ({ search }) => {
  // barSearchPages.update(search.pages.completed, {}, search.pages.sum);
  // barSearchInstances.update(search.instances.completed, {}, search.instances.sum);
  bar1.tick(_.toInteger(search.instances.completed / search.instances.sum * 100 - bar1.current), {
    completed: search.instances.completed,
    sum: search.instances.sum,
  });
  bar2.tick(_.toInteger(search.pages.completed / search.pages.sum * 100 - bar2.current), {
    completed: search.pages.completed,
    sum: search.pages.sum,
  });
};

const logStopLinkProgress = async () => {
  // barSearchPages.stop();
};

const logStartDataProgress = async ({ sum, retries, maxRetries }) => {
  console.log('Einträge downloaden');
  // barData.start(sum, 0, { retries, maxRetries });
  bar3 = new ProgressBar({
    schema: 'links [:bar] :percent :current/:total | :eta | :elapsed sec',
    total: sum,
  });
};

const logUpdateDataProgress = async ({ value, retries, maxRetries }) => {
  // barData.update(value, { retries, maxRetries });
  let tick = 0;
  if (value > bar3.current) {
    tick = 1;
  } else if (value < bar3.current) {
    tick = -1;
  }
  bar3.tick(tick);
};

const logStopDataProgress = async () => {
  // barData.stop();
};

/* const logError = ({ error }) => {
  console.log(error);
}; */

const outScraperData = async ({ procedureId, procedureData }) => {
  const directory = `files/${procedureData.VORGANG.WAHLPERIODE}/${
    procedureData.VORGANG.VORGANGSTYP
  }`;
  await fs.ensureDir(directory);
  jsonfile.writeFile(
    `${directory}/${procedureId}.json`,
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
/* if (process.platform === 'win32') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('SIGINT', () => {
    process.emit('SIGINT');
  });
} */

/*
process.stdin.resume();
// do something when app is closing
process.on('exit', scraper.finalize.bind(scraper));
process.on('SIGINT', scraper.finalize.bind(scraper));
// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', scraper.finalize.bind(scraper));
process.on('SIGUSR2', scraper.finalize.bind(scraper));
// catches uncaught exceptions
process.on('uncaughtException', scraper.finalize.bind(scraper));
*/
scraper
  .scrape({
    selectPeriods,
    selectOperationTypes,
    logStartLinkProgress,
    logUpdateLinkProgress,
    logStopLinkProgress,
    logStartDataProgress,
    logUpdateDataProgress,
    logStopDataProgress,
    logFinished,
    // logError,
    logFatalError,
    outScraperData,
    browserStackSize: 8,
  })
  .catch((error) => {
    console.error(error);
  });
