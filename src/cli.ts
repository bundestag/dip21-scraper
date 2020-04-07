#!/usr/bin/env node
/* eslint-disable no-mixed-operators */

import { clearLine, cursorTo } from 'readline';
import inquirer from 'inquirer';
import { IAvailableFilters, IStack, IStatus } from './types';

import Scraper from './scraper';
import { createCommand } from 'commander';
import jsonfile from 'jsonfile';
import fs from 'fs-extra';

const _ = require('lodash');
const prettyMs = require('pretty-ms');
const chalk = require('chalk');

const program = createCommand();

program
  .version('0.1.0')
  .description('Bundestag scraper')
  .option('-p, --periods [PeriodenNummers|Alle]', 'comma sperated period numbers', '')
  .option(
    '-t, --operationtypes <OperationTypeNummer|Alle>',
    'Select specified OperationTypes [null]',
    '',
  )
  .option('-u, --url [value]', 'Base url of dip21', 'dip21.bundestag.de')
  .option('-s, --stacksize <Integer>', 'size of paralell browsers', '1')
  .option('-q, --quiet', 'Silent Mode - No Outputs')
  .option('--html', 'scrape html version', 'html')
  .parse(process.argv);

const scraper = new Scraper({
  baseUrl: program.url as string,
});

const selectPeriods = async (periods: IAvailableFilters['periods']) => {
  const selectedPeriod = program.periods as string;
  if (!selectedPeriod) {
    const period = await inquirer.prompt<{ values: string[] }>({
      type: 'checkbox',
      name: 'values',
      message: 'Wähle eine Legislaturperiode',
      choices: periods,
    });
    return period.values
      .reduce<string[]>((pre, v) => {
      const selection = periods.find(({ value }) => value === v);
      if (selection) {
        return [...pre, selection.name];
      }
      return pre;
    }, [])
      .filter(v => v !== undefined);
  }
  return selectedPeriod.split(',').filter(name => periods.find(period => period.name === name));
};

const selectOperationTypes = async ({
  operationTypes,
}: {
operationTypes: IAvailableFilters['operationTypes'];
}) => {
  if (!program.operationtypes) {
    const operationType = await inquirer.prompt<{ values: string[] }>({
      type: 'checkbox',
      name: 'values',
      message: 'Wähle Vorgangstyp(en)',
      choices: operationTypes,
    });
    return operationType.values
      .map((v) => {
        const selection = operationTypes.find(({ value }) => value === v);
        if (selection) {
          return selection.number;
        }
        return undefined;
      })
      .filter(v => v !== undefined);
  }
  return (program.operationtypes as string).split(',');
};

const logFinished = async () => {
  console.log('############### FINISH ###############');
};

const logUpdateSearchProgress = async ({ search }: IStatus) => {
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0);
  process.stdout.write(`Instances: ${search.instances.completed}/${search.instances.sum} (${_.toInteger((search.instances.completed / search.instances.sum) * 100)}%) | Pages: ${search.pages.completed}/${search.pages.sum} (${_.toInteger((search.pages.completed / search.pages.sum) * 100)}%)`);
};

let linksSum = 0;
let startDate: Date;

const logStartDataProgress = async ({ sum }: { sum: number; retries: number }) => {
  startDate = new Date();
  process.stdout.write('\n');
  linksSum = sum;
};

function getColor(value: number) {
  // value from 0 to 1
  return (1 - value) * 120;
}

const logUpdateDataProgress = async ({ value, browsers }: { value: any; browsers: IStack[] }) => {
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0);
  process.stdout.write(`Links: ${_.toInteger((value / linksSum) * 100)}% | ${value}/${linksSum} | ${chalk.hsl(
    getColor(1 - value / linksSum),
    100,
    50,
  )(prettyMs(
    _.toInteger(((new Date().getTime() - startDate.getTime()) / value) * (linksSum - value)),
    {
      compact: true,
    },
  ))} | ${browsers.map(({ scraped }) => {
    if (_.maxBy(browsers, 'scraped').scraped === scraped) {
      return chalk.green(scraped);
    } else if (_.minBy(browsers, 'scraped').scraped === scraped) {
      return chalk.red(scraped);
    }
    return scraped;
  })} | ${browsers.map(({ errors }) => chalk.hsl(getColor(errors / 4), 100, 50)(errors))}`);
};

const outScraperData = async ({
  procedureId,
  procedureData,
}: {
procedureId: string;
procedureData: any;
}) => {
  // TYPE HELPER
  if (!procedureData.vorgangId) {
    console.log(procedureData);
    process.exit();
  }

  if (procedureData) {
    const directory = `files/${procedureData.VORGANG.WAHLPERIODE}/${procedureData.VORGANG.VORGANGSTYP}`;
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
  }
};

process.on('SIGINT', async () => {
  process.exit(1);
});

const logError = (error: Error) => {
  process.stdout.write('\n');
  console.log(error);
};

scraper
  .scrape({
    selectPeriods,
    selectOperationTypes,
    logUpdateSearchProgress: program.quiet ? () => {} : logUpdateSearchProgress,
    logStartDataProgress: program.quiet ? () => {} : logStartDataProgress,
    logStopDataProgress: () => process.stdout.write('\n'),
    logUpdateDataProgress: program.quiet ? () => {} : logUpdateDataProgress,
    logFinished: program.quiet ? () => {} : logFinished,
    outScraperData,
    browserStackSize: _.toInteger(program.stacksize),
    logError,
    scrapeType: program.html || 'live',
    liveScrapeStates: program.importantState ? program.importantState : [],
  })
  .catch((error) => {
    console.error(error);
  });
