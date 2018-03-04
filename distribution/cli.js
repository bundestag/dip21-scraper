#!/usr/bin/env node
'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/* eslint-disable no-mixed-operators */

const Scraper = require('./scraper');
const program = require('commander');
const inquirer = require('inquirer');
const jsonfile = require('jsonfile');
const fs = require('fs-extra');

const _ = require('lodash');
const prettyMs = require('pretty-ms');
const chalk = require('chalk');
const Log = require('log');

const log = new Log('error', fs.createWriteStream('error.log'));

program.version('0.1.0').description('Bundestag scraper').option('-p, --periods [PeriodenNummers|Alle]', 'comma sperated period numbers', null).option('-t, --operationtypes <OperationTypeNummer|Alle>', 'Select specified OperationTypes [null]', null).option('-s, --stacksize <Integer>', 'size of paralell browsers', 1).option('-q, --quiet', 'Silent Mode - No Outputs').parse(process.argv);

const scraper = new Scraper();

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
    return selectedPeriod.split(',').filter(function (name) {
      return periods.find(function (period) {
        return period.name === name;
      });
    });
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

const logUpdateSearchProgress = (() => {
  var _ref4 = _asyncToGenerator(function* ({ search }) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`Pages: ${_.toInteger(search.pages.completed / search.pages.sum * 100)}% | ${search.pages.completed}/${search.pages.sum} | Instances: ${search.instances.completed}/${search.instances.sum}`);
  });

  return function logUpdateSearchProgress(_x3) {
    return _ref4.apply(this, arguments);
  };
})();

let linksSum = 0;
let startDate;

const logStartDataProgress = (() => {
  var _ref5 = _asyncToGenerator(function* ({ sum }) {
    startDate = new Date();
    process.stdout.write('\n');
    console.log('links analysieren');
    linksSum = sum;
  });

  return function logStartDataProgress(_x4) {
    return _ref5.apply(this, arguments);
  };
})();

function getColor(value) {
  // value from 0 to 1
  return (1 - value) * 120;
}

const logUpdateDataProgress = (() => {
  var _ref6 = _asyncToGenerator(function* ({ value, browsers }) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`Links: ${_.toInteger(value / linksSum * 100)}% | ${value}/${linksSum} | ${chalk.hsl(getColor(1 - value / linksSum), 100, 50)(prettyMs(_.toInteger((new Date() - startDate) / value * (linksSum - value)), {
      compact: true
    }))} | ${browsers.map(function ({ scraped }) {
      if (_.maxBy(browsers, 'scraped').scraped === scraped) {
        return chalk.green(scraped);
      } else if (_.minBy(browsers, 'scraped').scraped === scraped) {
        return chalk.red(scraped);
      }
      return scraped;
    })} | ${browsers.map(function ({ errors }) {
      return chalk.hsl(getColor(errors / 4), 100, 50)(errors);
    })}`);
  });

  return function logUpdateDataProgress(_x5) {
    return _ref6.apply(this, arguments);
  };
})();

const outScraperData = (() => {
  var _ref7 = _asyncToGenerator(function* ({ procedureId, procedureData }) {
    if (procedureData) {
      const directory = `files/${procedureData.VORGANG.WAHLPERIODE}/${procedureData.VORGANG.VORGANGSTYP}`;
      yield fs.ensureDir(directory);
      jsonfile.writeFile(`${directory}/${procedureId}.json`, procedureData, {
        spaces: 2,
        EOL: '\r\n'
      }, function () /* err */{});
    }
  });

  return function outScraperData(_x6) {
    return _ref7.apply(this, arguments);
  };
})();

process.on('SIGINT', _asyncToGenerator(function* () {
  process.exit(1);
}));

const logError = ({ error }) => {
  console.log(error);
  if (error.type === 'fatal' && error.message) {
    console.log(error.message);
  }
  switch (error.code) {
    case 1004:
      break;

    default:
      log.error(error);
      break;
  }
};

scraper.scrape({
  selectPeriods,
  selectOperationTypes,
  logUpdateSearchProgress: program.quiet ? () => {} : logUpdateSearchProgress,
  logStartDataProgress: program.quiet ? () => {} : logStartDataProgress,
  logStopDataProgress: () => process.stdout.write('\n'),
  logUpdateDataProgress: program.quiet ? () => {} : logUpdateDataProgress,
  logFinished: program.quiet ? () => {} : logFinished,
  outScraperData,
  browserStackSize: _.toInteger(program.stacksize),
  logError
}).catch(error => {
  console.error(error);
});