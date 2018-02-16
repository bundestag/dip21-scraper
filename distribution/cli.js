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
// const readline = require('readline');

program.version('0.0.1').description('Bundestag scraper').option('-p, --period [PeriodenNummer|Alle]', 'Select a specified period [null]', null).option('-t, --operationtypes <OperationTypeNummer|Alle>', 'Select specified OperationTypes [null]', null).parse(process.argv);

const scraper = new Scraper();

let bar1;
let bar2;
let bar3;

const selectPeriods = (() => {
  var _ref = _asyncToGenerator(function* ({ periods }) {
    let selectedPeriod = program.period;
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
    } else if (!periods.find(function (period) {
      return period.name === selectedPeriod;
    })) {
      console.log(`'${selectedPeriod}' is not a valid option for period`);
      process.exit(1);
    }
    console.log(`Selected Period '${selectedPeriod}'`);
    return periods.find(function (period) {
      return period.name === selectedPeriod;
    }).name;
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

const logStartLinkProgress = (() => {
  var _ref4 = _asyncToGenerator(function* () {
    console.log('Eintragslinks sammeln');
    bar1 = new ProgressBar({
      schema: 'filters [:bar] :percent :completed/:sum | :estf | :duration'
    });
    bar2 = new ProgressBar({
      schema: 'pages [:bar] :percent :completed/:sum | :estf | :duration'
    });
  });

  return function logStartLinkProgress() {
    return _ref4.apply(this, arguments);
  };
})();

const logUpdateLinkProgress = (() => {
  var _ref5 = _asyncToGenerator(function* ({ search }) {
    // barSearchPages.update(search.pages.completed, {}, search.pages.sum);
    // barSearchInstances.update(search.instances.completed, {}, search.instances.sum);

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

  return function logUpdateLinkProgress(_x3) {
    return _ref5.apply(this, arguments);
  };
})();

const logStartDataProgress = (() => {
  var _ref6 = _asyncToGenerator(function* ({ sum }) {
    console.log('Einträge downloaden');
    // barData.start(sum, 0, { retries, maxRetries });
    bar3 = new ProgressBar({
      schema: 'links [:bar] :percent :current/:total | :estf | :duration',
      total: sum
    });
  });

  return function logStartDataProgress(_x4) {
    return _ref6.apply(this, arguments);
  };
})();

const logUpdateDataProgress = (() => {
  var _ref7 = _asyncToGenerator(function* ({ value }) {
    // barData.update(value, { retries, maxRetries });
    let tick = 0;
    if (value > bar3.current) {
      tick = 1;
    } else if (value < bar3.current) {
      tick = -1;
    }
    bar3.tick(tick, {
      estf: prettyMs(_.toInteger((new Date() - bar3.start) / bar3.current * (bar3.total - bar3.current)), { compact: true }),
      duration: prettyMs(_.toInteger(new Date() - bar3.start), { secDecimalDigits: 0 })
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
scraper.scrape({
  selectPeriods,
  selectOperationTypes,
  logStartLinkProgress,
  logUpdateLinkProgress,
  logStartDataProgress,
  logUpdateDataProgress,
  logFinished,
  logFatalError,
  outScraperData,
  browserStackSize: 7
}).catch(error => {
  console.error(error);
});