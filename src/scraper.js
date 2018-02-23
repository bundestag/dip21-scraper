/* eslint-disable max-len */
/* eslint-disable no-throw-literal */

const puppeteer = require('puppeteer');
const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');
const _ = require('lodash');
const chalk = require('chalk');
const Page = require('puppeteer/lib/Page');

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

    this.browser = await puppeteer.launch({
      timeout: this.options.defaultTimeout,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

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
        await this.goToSearch({ browser });
        await this.selectPeriod({ browser, periodName: this.filters[filterIndex].period });
        await this.selectOperationTypes({
          browser,
          operationTypeNumber: this.filters[filterIndex].operationType,
        });
        await this.startSearch({ browser })
          .then(() => {
            this.status.search.instances.completed += 1;
          })
          .catch(async (error) => {
            this.filters[filterIndex].scraped = false;
            throw { ...error, code: 1002 };
          });
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
        page: this.stack[browserIndex].page,
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
    await Promise.all(this.stack.map(async (b) => {
      await this.closePage(b);
    }));
    await this.browser.close();

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

  newPageWithNewContext = async ({ browser = this.browser }) => {
    const { browserContextId } = await browser._connection.send('Target.createBrowserContext');
    const { targetId } = await browser._connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const target = await browser._targets.get(targetId);
    const client = await browser._connection.createSession(targetId);
    const page = await Page.create(client, target, browser._ignoreHTTPSErrors, browser._screenshotTaskQueue);
    page.setDefaultNavigationTimeout(this.options.defaultTimeout);
    page.browserContextId = browserContextId;
    return page;
  }

  closePage = async ({ browser, page }) => {
    if (page.browserContextId !== undefined) {
      await browser._connection.send('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
    }
    await page.close().catch(() => {});
  }

  createNewBrowser = async ({ browserObject = { } } = {}) => {
    const { timeoutStart } = this.options;
    if (browserObject.page) {
      await this.closePage(browserObject);
    }
    try {
      const page = await this.newPageWithNewContext(browserObject);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        switch (request.resourceType()) {
          case 'image':
          case 'script':
          case 'stylesheet':
            request.abort();
            break;

          default:
            request.continue();
            break;
        }
      });
      await page.goto(this.urls.start, {
        timeout: timeoutStart,
      });
      return {
        browser: this.browser,
        page,
        used: false,
        scraped: 0,
        errors: 0,
      };
    } catch (error) {
      this.options.logError({
        error,
        function: 'createNewBrowser',
      });
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(await this.createNewBrowser({ browserObject }));
        }, 10000);
      });
    }
  };

  async goToSearch({ browser }) {
    const cookies = await browser.page.cookies().catch((error) => {
      throw {
        error,
        function: 'goToSearch',
        code: 1004,
      };
    });
    const jssessionCookie = cookies.filter(c => c.name === 'JSESSIONID');
    await browser.page.goto(this.urls.search + jssessionCookie[0].value, {
      timeout: this.options.timeoutSearch(),
    });
  }

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
    if (selectedOperationTypes.includes('all') || selectedOperationTypes.length === 0) {
      selectedOperationTypes = operationTypes
        .filter(({ name }) => name !== 'Alle')
        .map(({ number }) => number);
    }

    return { periods: selectedPeriods, operationTypes: selectedOperationTypes };
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
    const browser = this.getFreeBrowser();
    browser.used = true;
    await this.goToSearch({ browser });
    const periods = await this.takePeriods({ browser });
    const operationTypes = await this.takeOperationTypes({ browser });
    browser.used = false;
    return {
      periods,
      operationTypes,
    };
  };

  async getResultInfos({ browser }) {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    await browser.page
      .waitForSelector('#footer', { timeout: this.options.timeoutSearch() })
      .catch((error) => {
        throw {
          error,
          code: 1006,
          function: 'getResultInfos',
        };
      });
    const resultsNumberString = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#inhaltsbereich',
    );
    const paginator = resultsNumberString.match(reg);

    return {
      pageCurrent: _.toInteger(paginator[1]),
      pageSum: _.toInteger(paginator[2]),
      entriesFrom: _.toInteger(paginator[3]),
      entriesTo: _.toInteger(paginator[4]),
      entriesSum: _.toInteger(paginator[5]),
    };
  }

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

  startSearch = async ({ browser }) => {
    // await this.clickWait({ browser, selector: 'input#btnSuche' });
    let hasEntries = true;
    await Promise.all([
      browser.page.click('input#btnSuche'),
      browser.page.waitForSelector('#tabReiter0 > a', { timeout: 3000 }),
      browser.page.waitForSelector('#footer'),
    ]).catch(async (error) => {
      if (
        (await browser.page.$eval(
          '#inhaltsbereich > div.inhalt > div.contentBox > fieldset.field.infoField > ul > li',
          e => e.innerHTML.trim(),
        )) === 'Es konnte kein Datensatz gefunden werden.'
      ) {
        hasEntries = false;
      } else {
        throw { ...error, code: 1007 };
      }
    });
    if (!hasEntries || (await this.isSingleResult({ browser }))) {
      return;
    }
    const resultInfos = await this.getResultInfos({ browser });
    this.status.search.pages.sum += resultInfos.pageSum;
    let pagesCompleted = 0;
    for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i += 1) {
      try {
        const pageLinks = await this.getEntriesFromPage({ browser });
        this.procedures.push(...pageLinks);
        const curResultInfos = await this.getResultInfos({ browser });
        this.status.search.pages.completed += 1;
        pagesCompleted += 1;
        if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
          await this.clickWait({
            browser,
            selector:
              '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input',
          });
        }
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

  async saveJson({ link, page }) {
    const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
    await page.goto(link).catch((error) => {
      throw {
        error,
        type: 'timeout',
        url: link,
        function: 'saveJson',
        code: 1010,
      };
    });
    let content;
    try {
      content = await page.evaluate(
        sel => document.querySelector(sel).innerHTML,
        '#inhaltsbereich',
      );
    } catch (error) {
      throw {
        error,
        type: 'not found',
        url: link,
        function: 'saveJson',
        code: 1011,
      };
    }

    let procedureId;
    try {
      procedureId = content.match(procedureIdRegex)[1]; // eslint-disable-line
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

    const dataProcedure = await Scraper.getProcedureData({ page });
    await page.goto(`${this.urls.processRunning}${vorgangId}`).catch((error) => {
      throw {
        error,
        type: 'timeout',
        url: link,
        function: 'saveJson',
        code: 1014,
      };
    });
    const dataProcedureRunning = await Scraper.getProcedureRunningData({ page });

    const procedureData = {
      vorgangId,
      ...dataProcedure,
      ...dataProcedureRunning,
    };
    this.options.outScraperData({ procedureId, procedureData });
  }

  static async getProcedureData({ page }) {
    const xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    const html = await page.content();
    const xmlString = html.match(xmlRegex)[0].replace('<- VORGANGSABLAUF ->', '');
    return x2j.xml2js(xmlString);
  }

  static async getProcedureRunningData({ page }) {
    const xmlRegex = /<VORGANGSABLAUF>(.|\n)*?<\/VORGANGSABLAUF>/;
    const html = await page.content();
    try {
      const xmlString = html.match(xmlRegex)[0];
      return x2j.xml2js(xmlString);
    } catch (error) {
      throw {
        type: 'warning',
        url: await page.url(),
        error,
        function: 'getProcedureRunningData',
        code: 1015,
      };
    }
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
