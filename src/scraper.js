/* eslint-disable max-len */
/* eslint-disable no-throw-literal */

import fs from 'fs';
import DipBrowser from './DipBrowser';

const $ = require('cheerio');
const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');
const _ = require('lodash');
const chalk = require('chalk');


const x2j = new X2JS();

process.setMaxListeners(Infinity);

class Scraper {
  options = {
    selectPeriods: false,
    selectOperationTypes: false,
    logStartSearchProgress: () => {},
    logUpdateSearchProgress: () => {},
    logStopSearchProgress: () => {},
    logStartDataProgress: () => {},
    logUpdateDataProgress: () => {},
    logStopDataProgress: () => {},
    logFinished: () => {},
    logError: () => {},
    outScraperData: () => {},
    doScrape: () => true,
    browserStackSize: 1,
    timeoutStart: 3001,
    timeoutSearch: () => 5001,
    maxRetries: () => 20,
    defaultTimeout: 15000,
    resultsPerPage: 200,
  };

  urls = {
    basisInfos: 'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail.do',
    processRunning:
      'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail_vp.do?vorgangId=',
    start: 'https://dipbt.bundestag.de/dip21.web/bt',
    search: 'https://dipbt.bundestag.de/dip21.web/searchProcedures.do;jsessionid=',
  };

  stack = [];
  availableFilters = {
    periods: [],
    operationTypes: [],
  };
  filters = [];
  procedures = [];
  status = {
    search: {
      instances: {
        sum: 0,
        completed: 0,
      },
      pages: {
        sum: 0,
        completed: 0,
      },
    },
  };
  browser;

  async scrape(options) {
    this.options = { ...this.options, ...options };
    const { browserStackSize } = this.options;
    this.stack = await Promise.all(this.createBrowserStack({
      size: browserStackSize,
    }));
    this.availableFilters = await this.takeSearchableValues().catch((error) => {
      this.finalize();
      throw {
        error,
        message: 'Bundestag ist DOWN!!!',
        type: chalk.red('fatal'),
        code: 1001,
      };
    });
    const filtersSelected = await this.configureFilter(this.availableFilters);
    this.options.logStartSearchProgress(this.status);
    await this.collectProcedures(filtersSelected);

    // Data
    this.completedLinks = 0;
    await this.options.logStartDataProgress({
      sum: this.procedures.length,
      retries: this.retries,
      maxRetries: this.options.maxRetries,
    });
    this.options.logStopSearchProgress();

    await Promise.all(this.stack.map(async (browser, browserIndex) => {
      await this.startAnalyse(browserIndex);
    })).then(async () => {
      this.options.logUpdateDataProgress({
        value: this.completedLinks,
        retries: this.retries,
        maxRetries: this.options.maxRetries,
        browsers: this.stack,
      });
      // Finalize
      this.options.logStopDataProgress();
      await this.finalize();
      this.options.logFinished();
    });
  }

  collectProcedures = async ({ periods, operationTypes }) => {
    periods.forEach((period) => {
      this.filters = [
        ...this.filters,
        ...operationTypes.map(operationType => ({ period, operationType, scraped: false })),
      ];
    });

    this.status.search.instances.sum = this.filters.length;

    await Promise.all(this.stack.map((browser, browserIndex) =>
      this.getProceduresFromSearch({ browser, browserIndex })));
    this.procedures = _.uniqBy(this.procedures, 'id');
  };

  getProceduresFromSearch = async ({ browser, browserIndex }) => {
    const filterIndex = this.filters.findIndex(({ scraped }) => !scraped);
    if (filterIndex !== -1) {
      this.filters[filterIndex].scraped = true;
      try {
        const searchBody = await browser.browser.getBeratungsablaeufeSearchPage();
        const { formData, formMethod, formAction } = await browser.browser.getBeratungsablaeufeSearchFormData({ body: searchBody });
        formData.wahlperiode = this.filters[filterIndex].period;
        formData.vorgangstyp = this.filters[filterIndex].operationType;
        formData.method = 'Suchen';
        formData.anzahlTreffer = this.options.resultsPerPage;

        await this.startSearch({
          browser, formData, formMethod, formAction,
        });
        this.status.search.instances.completed += 1;

        // await this.goToSearch({ browser });
        // await this.selectPeriod({ browser, periodName: this.filters[filterIndex].period });
        // await this.selectOperationTypes({
        //   browser,
        //   operationTypeNumber: this.filters[filterIndex].operationType,
        // });
        // await this.startSearch({ browser })
        //   .then(() => {
        //     this.status.search.instances.completed += 1;
        //   })
        //   .catch(async (error) => {
        //     this.filters[filterIndex].scraped = false;
        //     throw { ...error, code: 1002 };
        //   });
      } catch (error) {
        this.options.logError({ error });
        this.filters[filterIndex].scraped = false;
        this.stack[browserIndex].errors += 1;
        if (this.stack[browserIndex].errors >= 5) {
          await this.createNewBrowser({ browserObject: this.stack[browserIndex] }).then((newBrowser) => {
            this.stack[browserIndex] = newBrowser;
          }).catch((error2) => {
            this.options.logError({ error2, function: 'getProceduresFromSearch' });
          });
        }
      } finally {
        this.options.logUpdateSearchProgress(this.status);
        await this.getProceduresFromSearch({ browser, browserIndex });
      }
    }
    this.options.logUpdateSearchProgress(this.status);
  };

  async startAnalyse(browserIndex) {
    const linkIndex = this.procedures.findIndex(({ scraped }) => !scraped);
    if (linkIndex !== -1) {
      this.stack[browserIndex].used = true;
      this.procedures[linkIndex].scraped = true;
      await this.saveJson({
        link: this.procedures[linkIndex].url,
        dipBrowser: this.stack[browserIndex].browser,
      })
        .then(async () => {
          this.completedLinks += 1;
          this.stack[browserIndex].used = false;
          this.stack[browserIndex].scraped += 1;
        })
        .catch(async (error) => {
          this.options.logError({ error });
          this.procedures[linkIndex].scraped = false;
          this.stack[browserIndex].used = false;
          this.stack[browserIndex].errors += 1;

          if (this.stack[browserIndex].errors >= 5) {
            await this.createNewBrowser({ browserObject: this.stack[browserIndex] }).then(async (newBrowser) => {
              this.stack[browserIndex] = newBrowser;
            }).catch(() => {

            });
          }
        })
        .then(async () => {
          this.options.logUpdateDataProgress({
            value: this.completedLinks,
            retries: this.retries,
            maxRetries: this.options.maxRetries,
            browsers: this.stack,
          });
          await this.startAnalyse(browserIndex);
        });
    }
  }

  finalize = async () => {
    this.stack = [];
    this.availableFilters = {
      periods: [],
      operationTypes: [],
    };
    this.filters = [];
    this.procedures = [];
    this.status = {
      search: {
        instances: {
          sum: 0,
          completed: 0,
        },
        pages: {
          sum: 0,
          completed: 0,
        },
      },
    };
  };

  createBrowserStack = ({ size }) => [...Array(size)].map(async () => this.createNewBrowser());

  createNewBrowser = async () => {
    const browser = new DipBrowser();
    await browser.initialize();
    return {
      browser,
      used: false,
      scraped: 0,
      errors: 0,
    };
  };

  configureFilter = async ({ periods, operationTypes }) => {
    // Periods
    let selectedPeriods = [];
    if (_.isArray(this.options.selectPeriods)) {
      selectedPeriods = this.options.selectPeriods;
    } else if (_.isFunction(this.options.selectPeriods)) {
      selectedPeriods = await this.options.selectPeriods({ periods });
    } else {
      throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof this
        .options.selectPeriods}"`);
    }
    if (selectedPeriods.includes('Alle') || selectedPeriods.length === 0) {
      selectedPeriods = periods.filter(({ name }) => name !== 'Alle').map(({ name }) => name);
    }

    // OperationTypes
    let selectedOperationTypes = [];
    if (_.isArray(this.options.selectOperationTypes)) {
      selectedOperationTypes = this.options.selectOperationTypes;
    } else if (_.isFunction(this.options.selectOperationTypes)) {
      selectedOperationTypes = await this.options.selectOperationTypes({ operationTypes });
    } else {
      throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof this
        .options.selectOperationTypes}"`);
    }
    if (selectedOperationTypes.includes('Alle') || selectedOperationTypes.length === 0) {
      selectedOperationTypes = operationTypes
        .filter(({ name }) => name !== 'Alle')
        .map(({ number }) => number);
    }

    return {
      periods: selectedPeriods.map(p => periods.find(({ name }) => name === p).value),
      operationTypes: selectedOperationTypes.map(n => operationTypes.find(({ number }) => number === n).value),
    };
  };

  async takePeriods({ browser }) {
    await browser.page.waitForSelector('input#btnSuche', { timeout: this.options.timeoutSearch() });
    const selectField = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#wahlperiode',
    );
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  takeOperationTypes = async ({ browser }) => {
    const selectField = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#includeVorgangstyp',
    );
    const values = x2j.xml2js(selectField).select.option.map(o => ({
      value: o._value,
      name: o.__text,
      number: o.__text.match(/\d{3}/) ? o.__text.match(/\d{3}/)[0] : 'all',
    }));
    return values;
  };

  async selectPeriod({ browser, periodName }) {
    const period = this.availableFilters.periods.find(p => p.name === periodName);
    await Promise.all([
      browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
      browser.page.select('select#wahlperiode', period.value),
    ]).catch((error) => {
      throw {
        error,
        function: 'selectPeriod',
        code: 1005,
      };
    });
  }

  async selectOperationTypes({ browser, operationTypeNumber }) {
    const operationType = this.availableFilters.operationTypes.find(o => o.number === operationTypeNumber);
    if (!operationType) {
      throw new Error(`OperationType "${operationTypeNumber}" not found`);
    }
    await browser.page.select('select#includeVorgangstyp', `${operationType.value}`);
  }

  getFreeBrowser = () => this.stack.find(({ used }) => !used);

  takeSearchableValues = async () => {
    const browserObj = this.getFreeBrowser();
    browserObj.used = true;
    const searchBody = await browserObj.browser.getBeratungsablaeufeSearchPage();
    const searchOptions = await browserObj.browser.getBeratungsablaeufeSearchOptions({
      body: searchBody,
    });
    browserObj.used = false;
    return {
      periods: searchOptions.wahlperioden,
      operationTypes: searchOptions.vorgangstyp,
    };
  };

  isSingleResult = async ({ browser }) => {
    try {
      const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
      const content = await browser.page.evaluate(
        sel => document.querySelector(sel).innerHTML,
        '#inhaltsbereich',
      );

      const procedureId = content.match(procedureIdRegex)[1];
      if (procedureId) {
        this.procedures.push({
          id: procedureId.split('-')[1],
          url: `http://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_list.do?selId=${
            procedureId.split('-')[1]
          }&method=select`,
          scraped: false,
        });
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  startSearch = async ({
    browser, formData, formMethod, formAction,
  }) => {
    // await this.clickWait({ browser, selector: 'input#btnSuche' });
    const hasEntries = true;
    // await Promise.all([
    //   browser.page.click('input#btnSuche'),
    //   browser.page.waitForSelector('#tabReiter0 > a', { timeout: 3000 }),
    //   browser.page.waitForSelector('#footer'),
    // ]).catch(async (error) => {
    //   if (
    //     (await browser.page.$eval(
    //       '#inhaltsbereich > div.inhalt > div.contentBox > fieldset.field.infoField > ul > li',
    //       e => e.innerHTML.trim(),
    //     )) === 'Es konnte kein Datensatz gefunden werden.'
    //   ) {
    //     hasEntries = false;
    //   } else {
    //     throw { ...error, code: 1007 };
    //   }
    // });
    // if (!hasEntries || (await this.isSingleResult({ browser }))) {
    //   return;
    // }

    const { body: searchResultBody } = await browser.browser.getSearchResultPage({
      formMethod,
      formAction,
      formData,
    });

    const resultInfos = await browser.browser.getResultInfo({ body: searchResultBody });

    if (!resultInfos) {
      return;
    } else if (resultInfos === 'isEntry') {
      fs.writeFile('html.html', searchResultBody, () => {});
      const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
      // console.log(searchResultBody)
      const vorgangId = searchResultBody.match(procedureIdRegex)[1];
      this.procedures.push({
        id: vorgangId.split('-')[1],
        url: `/dip21.web/searchProcedures/simple_search_list.do?selId=${vorgangId.split('-')[1]}&method=select&offset=0&anzahl=200&sort=3&direction=desc`,
        scraped: false,
      });
      return;
    }

    this.status.search.pages.sum += resultInfos.pageSum;
    let pagesCompleted = 0;
    let searchResultBodyToAnalyse = searchResultBody;
    for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i += 1) {
      try {
        if (i !== 1) {
          formData.offset = (i - 1) * this.options.resultsPerPage; // eslint-disable-line
          const { body: tmpBody } = await browser.browser.getSearchResultPage({
            formMethod,
            formAction,
            formData,
          });
          searchResultBodyToAnalyse = tmpBody;
        }

        const pageLinks = browser.browser.getEntries({ body: searchResultBodyToAnalyse });

        // const pageLinks = await this.getEntriesFromPage({ browser });
        this.procedures.push(...pageLinks);
        this.status.search.pages.completed += 1;
        pagesCompleted += 1;
      } catch (error) {
        this.status.search.pages.sum -= resultInfos.pageSum;
        this.status.search.pages.completed -= pagesCompleted;
        throw {
          error,
          function: 'startSearch',
          type: 'timeout',
          code: 1008,
        };
      } finally {
        this.options.logUpdateSearchProgress(this.status);
      }
    }
  };

  async getEntriesFromPage({ browser }) {
    const links = await browser.page.$$eval(
      '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody > tr',
      els =>
        els.map((el) => {
          const urlSelector = el.querySelector('a.linkIntern');
          const dateSelector = el.querySelector('td:nth-child(4)');
          if (urlSelector && dateSelector) {
            return {
              id: urlSelector.href.match(/selId=(\d.*?)&/)[1],
              url: urlSelector.href,
              date: dateSelector.innerHTML,
              scraped: false,
            };
          }
          const error = new Error('Could not get Entries from Page');
          throw {
            error,
            code: 1009,
          };
        }),
    );
    return links.filter(link => this.options.doScrape({ data: link }));
  }

  async saveJson({ link, dipBrowser }) {
    const procedureIdRegex = /\[ID:&#xA0;(.*?)\]/;
    const { body: entryBody } = await dipBrowser.request({
      uri: link,
    });


    const procedureHtml = $('#inhaltsbereich', entryBody).html();

    let procedureId;
    try {
      procedureId = procedureHtml.match(procedureIdRegex)[1]; // eslint-disable-line
    } catch (error) {
      throw {
        error,
        code: 1012,
      };
    }
    const urlObj = Url.parse(link);
    const queryObj = Querystring.parse(urlObj.query);
    const vorgangId = queryObj.selId;
    if (procedureId.split('-')[1] !== vorgangId) {
      const error = new Error(`Procedure ID missmatch URL: "${vorgangId}" to HTML: "${procedureId.split('-')[1]}"`);
      throw {
        error,
        code: 1013,
      };
    }

    const dataProcedure = await this.getProcedureData({ html: procedureHtml });

    const { body: entryRunningBody } = await dipBrowser.request({
      uri: `${this.urls.processRunning}${vorgangId}`,
    });

    const procedureRunningHtml = $('#inhaltsbereich', entryRunningBody).html();

    const dataProcedureRunning = await Scraper.getProcedureRunningData({ html: procedureRunningHtml });

    const procedureData = {
      vorgangId,
      ...dataProcedure,
      ...dataProcedureRunning,
    };
    this.options.outScraperData({ procedureId, procedureData });
  }

   getProcedureData = async ({ html }) => {
     const xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
     const xmlString = html.match(xmlRegex)[0].replace('<- VORGANGSABLAUF ->', '');
     return x2j.xml2js(xmlString);
   }

   static async getProcedureRunningData({ html }) {
     const xmlRegex = /<VORGANGSABLAUF>(.|\n)*?<\/VORGANGSABLAUF>/;
     const xmlString = html.match(xmlRegex)[0];
     return x2j.xml2js(xmlString);
   }

   clickWait({ browser, selector }) {
     return Promise.all([
       browser.page.click(selector),
       browser.page.waitForNavigation({
         waitUntil: ['domcontentloaded'],
       }),
       browser.page.waitForSelector('#footer', { timeout: this.options.timeoutSearch() }),
     ]);
   }
}

module.exports = Scraper;
