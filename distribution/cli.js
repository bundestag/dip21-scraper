#!/usr/bin/env node
'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/* eslint-disable no-mixed-operators */

const Scraper = require('./scraper');
const program = require('commander');
const inquirer = require('inquirer');
const jsonfile = require('jsonfile');
const fs = require('fs-extra');
const ProgressBar = require('ascii-progress');
const _ = require('lodash');
const prettyMs = require('pretty-ms');
const chalk = require('chalk');
const Log = require('log');

const log = new Log('debug', fs.createWriteStream('error.log'));

program.version('0.1.0').description('Bundestag scraper').option('-p, --periods [PeriodenNummers|Alle]', 'comma sperated period numbers', null).option('-t, --operationtypes <OperationTypeNummer|Alle>', 'Select specified OperationTypes [null]', null).option('-s, --stacksize <Integer>', 'size of paralell browsers', 1).option('-q, --quiet', 'Silent Mode - No Outputs').parse(process.argv);

const scraper = new Scraper();

let bar1;
let bar2;
let bar3;

const selectPeriods = (() => {
  var _ref = _asyncToGenerator(function* ({ periods }) {
    let selectedPeriod = program.periods;
    if (!selectedPeriod) {
      const period = yield inquirer.prompt({
        type: 'checkbox',
        name: 'values',
        message: 'Wähle eine Legislaturperiode',
        choices: periods
      });
      selectedPeriod = period.values.map(function (v) {
        const selection = periods.find(function ({ value }) {
          return value === v;
        });
        if (selection) {
          return selection.name;
        }
        return undefined;
      }).filter(function (v) {
        return v !== undefined;
      });
      return selectedPeriod;
    }
    // else if (!periods.find(period => period.name === selectedPeriod)) {
    //   console.log(`'${selectedPeriod}' is not a valid option for period`);
    //   process.exit(1);
    // }
    return selectedPeriod.split(',').filter(function (name) {
      return periods.find(function (period) {
        return period.name === name;
      });
    });
    // return periods.find(period => period.name === selectedPeriod).name;
  });

  return function selectPeriods(_x) {
    return _ref.apply(this, arguments);
  };
})();

const selectOperationTypes = (() => {
  var _ref2 = _asyncToGenerator(function* ({ operationTypes }) {
    let selectedOperationTypes = [];
    if (!program.operationtypes) {
      const operationType = yield inquirer.prompt({
        type: 'checkbox',
        name: 'values',
        message: 'Wähle Vorgangstyp(en)',
        choices: operationTypes
      });
      selectedOperationTypes = operationType.values.map(function (v) {
        const selection = operationTypes.find(function ({ value }) {
          return value === v;
        });
        if (selection) {
          return selection.number;
        }
        return undefined;
      }).filter(function (v) {
        return v !== undefined;
      });
    } else {
      selectedOperationTypes = program.operationtypes.split(',');
    }
    return selectedOperationTypes;
  });

  return function selectOperationTypes(_x2) {
    return _ref2.apply(this, arguments);
  };
})();

const logFinished = (() => {
  var _ref3 = _asyncToGenerator(function* () {
    console.log('############### FINISH ###############');
  });

  return function logFinished() {
    return _ref3.apply(this, arguments);
  };
})();

const logStartSearchProgress = (() => {
  var _ref4 = _asyncToGenerator(function* () {
    bar1 = new ProgressBar({
      schema: 'filters [:bar] :percent :completed/:sum | :estf | :duration',
      width: 20
    });
    bar2 = new ProgressBar({
      schema: 'pages [:bar] :percent :completed/:sum | :estf | :duration',
      width: 20
    });
  });

  return function logStartSearchProgress() {
    return _ref4.apply(this, arguments);
  };
})();

const logUpdateSearchProgress = (() => {
  var _ref5 = _asyncToGenerator(function* ({ search }) {
    bar1.tick(_.toInteger(search.instances.completed / search.instances.sum * 100 - bar1.current), {
      completed: search.instances.completed,
      sum: search.instances.sum,
      estf: prettyMs(_.toInteger((new Date() - bar1.start) / bar1.current * (bar1.total - bar1.current)), { compact: true }),
      duration: prettyMs(_.toInteger(new Date() - bar1.start), { secDecimalDigits: 0 })
    });
    bar2.tick(_.toInteger(search.pages.completed / search.pages.sum * 100 - bar2.current), {
      completed: search.pages.completed,
      sum: search.pages.sum,
      estf: prettyMs(_.toInteger((new Date() - bar2.start) / bar2.current * (bar2.total - bar2.current)), { compact: true }),
      duration: prettyMs(_.toInteger(new Date() - bar2.start), { secDecimalDigits: 0 })
    });
  });

  return function logUpdateSearchProgress(_x3) {
    return _ref5.apply(this, arguments);
  };
})();

const logStartDataProgress = (() => {
  var _ref6 = _asyncToGenerator(function* ({ sum }) {
    console.log('links analysieren');
    bar3 = new ProgressBar({
      schema: 'links | :cpercent | :current/:total | :estf | :duration | :browsersRunning | :browsersScraped | :browserErrors ',
      total: sum
    });
  });

  return function logStartDataProgress(_x4) {
    return _ref6.apply(this, arguments);
  };
})();

function getColor(value) {
  // value from 0 to 1
  return (1 - value) * 120;
}

const logUpdateDataProgress = (() => {
  var _ref7 = _asyncToGenerator(function* ({ value, browsers }) {
    // barData.update(value, { retries, maxRetries });
    let tick = 0;
    if (value > bar3.current) {
      tick = 1;
    } else if (value < bar3.current) {
      tick = -1;
    }
    bar3.tick(tick, {
      estf: chalk.hsl(getColor(1 - bar3.current / bar3.total), 100, 50)(prettyMs(_.toInteger((new Date() - bar3.start) / bar3.current * (bar3.total - bar3.current)), { compact: true })),
      duration: prettyMs(_.toInteger(new Date() - bar3.start), { secDecimalDigits: 0 }),
      browserErrors: browsers.map(function ({ errors }) {
        return chalk.hsl(getColor(errors / 5), 100, 50)(errors);
      }),
      browsersRunning: browsers.reduce(function (count, { used }) {
        return count + (used ? 1 : 0);
      }, 0),
      browsersScraped: browsers.map(function ({ scraped }) {
        if (_.maxBy(browsers, 'scraped').scraped === scraped) {
          return chalk.green(scraped);
        } else if (_.minBy(browsers, 'scraped').scraped === scraped) {
          return chalk.red(scraped);
        }
        return scraped;
      }),
      cpercent: chalk.hsl(getColor(1 - bar3.current / bar3.total), 100, 50)(`${(bar3.current / bar3.total * 100).toFixed(1)}%`)
    });
  });

  return function logUpdateDataProgress(_x5) {
    return _ref7.apply(this, arguments);
  };
})();

const outScraperData = (() => {
  var _ref8 = _asyncToGenerator(function* ({ procedureId, procedureData }) {
    const directory = `files/${procedureData.VORGANG.WAHLPERIODE}/${procedureData.VORGANG.VORGANGSTYP}`;
    yield fs.ensureDir(directory);
    jsonfile.writeFile(`${directory}/${procedureId}.json`, procedureData, {
      spaces: 2,
      EOL: '\r\n'
    }, function () /* err */{});
  });

  return function outScraperData(_x6) {
    return _ref8.apply(this, arguments);
  };
})();

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

process.on('SIGINT', _asyncToGenerator(function* () {
  process.exit(1);
}));

const logError = ({ error }) => {
  log(error);
};

scraper.scrape({
  selectPeriods,
  selectOperationTypes,
  logStartSearchProgress: program.quiet ? () => {} : logStartSearchProgress,
  logUpdateSearchProgress: program.quiet ? () => {} : logUpdateSearchProgress,
  logStartDataProgress: program.quiet ? () => {} : logStartDataProgress,
  logUpdateDataProgress: program.quiet ? () => {} : logUpdateDataProgress,
  logFinished: program.quiet ? () => {} : logFinished,
  outScraperData,
  browserStackSize: _.toInteger(program.stacksize),
  logError: program.quiet ? () => {} : logError
}).catch(error => {
  console.error(error);
});