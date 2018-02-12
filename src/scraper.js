const puppeteer = require('puppeteer');
const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');

const x2j = new X2JS();

const URLS = {
  basisInfos: 'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail.do',
  processRunning:
    'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail_vp.do',
  start: 'https://dipbt.bundestag.de/dip21.web/bt',
  search: 'https://dipbt.bundestag.de/dip21.web/searchProcedures.do;jsessionid=',
};

class Scraper {
  defaultOptions = {
    selectPeriod: () => '',
    selectOperationTypes: () => [''],
    logStartLinkProgress: () => {},
    logUpdateLinkProgress: () => {},
    logStopLinkProgress: () => {},
    logStartDataProgress: () => {},
    logUpdateDataProgress: () => {},
    logStopDataProgress: () => {},
    logFinished: () => {},
    logError: () => {},
    logFatalError: () => {},
    outScraperLinks: () => {},
    outScraperData: () => {},
    doScrape: () => true,
    browserStackSize: () => 1,
    timeoutStart: () => 10000,
    timeoutSearch: () => 5000,
    maxRetries: () => 20,
  };

  async scrape(options) {
    this.options = { ...this.defaultOptions, ...options };
    this.stack = await Promise.all(this.createBrowserStack());
    this.browser = await this.findFreeBrowser(); // Main Browser from the stack
    await this.goToSearch();

    // Select Period & operationTypes
    await this.selectPeriod();
    await this.selectOperationTypes();

    // Search
    await this.search();
    this.links = await this.getEntriesFromSearch();
    await this.options.logStartDataProgress(this.links.length, this.getErrorCount());

    // Data
    this.completedLinks = 0;
    this.retries = 0;
    const promises = this.stack.map(async (browser, browserIndex) => {
      await this.startAnalyse(browserIndex);
    });
    await Promise.all(promises).then(() => {
      // Finalize
      this.options.logStopDataProgress();
      this.finalize();
      this.options.logFinished();
    });
  }

  async analyseLink(link, browser) {
    await Scraper.saveJson(link.url, browser.page, this.options.outScraperData).then(() => {
      this.completedLinks += 1;
      this.options.logUpdateDataProgress(this.completedLinks, this.getErrorCount());
    });
  }

  async startAnalyse(browserIndex) {
    const linkIndex = this.links.findIndex(({ scraped }) => !scraped);
    if (linkIndex !== -1) {
      this.links[linkIndex].scraped = true;
      await this.analyseLink(this.links[linkIndex], this.stack[browserIndex])
        .then(() => {
          this.options.outScraperLinks(this.links);
        })
        .catch(async (err) => {
          this.options.logError(err);
          this.stack[browserIndex].errorCount += 1;
          this.links[linkIndex].scraped = false;
          if (this.stack[browserIndex].errorCount > 5) {
            await this.createNewBrowser(this.stack[browserIndex])
              .then((newBrowser) => {
                this.stack[browserIndex] = newBrowser;
                this.options.logUpdateDataProgress(this.completedLinks, this.getErrorCount());
              })
              .catch(err2 => this.options.logError(err2));
          }
        });
      await this.startAnalyse(browserIndex);
    }
  }

  async findFreeBrowser() {
    return this.stack.find(({ used }) => used === false);
  }

  finalize() {
    this.stack.forEach(b => b.browser.close());
  }

  fatalError({ error }) {
    this.options.logFatalError(error);
    this.options.logStopLinkProgress();
    this.options.logStopDataProgress();
    this.finalize();
    throw error;
  }

  createBrowserStack() {
    return [...Array(this.options.browserStackSize())].map(browserObject =>
      this.createNewBrowser(browserObject));
  }

  getErrorCount() {
    return {
      errorCounter: this.stack.map(({ errorCount }) => (errorCount < 1 ? errorCount : `${errorCount}`.red)),
    };
  }

  async createNewBrowser(browserObject = {}) {
    if (browserObject.browser) {
      await browserObject.browser.close();
    }
    /* if (browserObject) {
      browserObject.errorCount += 1;
    } */
    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
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
      await page.goto(URLS.start, {
        timeout: this.options.timeoutStart(),
      });
      return {
        browser,
        page,
        used: false,
        errorCount: 0,
      };
    } catch (error) {
      if (this.options.maxRetries() < this.retries) {
        this.retries += 1;
        return this.createNewBrowser(browserObject);
      }
      this.fatalError({ error }); // throws
      return null;
    }
  }

  async goToSearch() {
    const cookies = await this.browser.page.cookies();
    const jssessionCookie = cookies.filter(c => c.name === 'JSESSIONID');
    await this.browser.page.goto(URLS.search + jssessionCookie[0].value);
  }

  async takePeriods() {
    await this.browser.page
      .waitForSelector('input#btnSuche', { timeout: this.options.timeoutSearch() })
      .catch((error) => {
        this.fatalError({ error });
      });
    const selectField = await this.browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#wahlperiode',
    );
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  async selectPeriod() {
    const periods = await this.takePeriods();
    await Promise.all([
      this.browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
      this.browser.page.select('select#wahlperiode', await this.options.selectPeriod(periods)),
    ]);
  }

  async takeOperationTypes() {
    const selectField = await this.browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#includeVorgangstyp',
    );
    const values = x2j.xml2js(selectField).select.option.map(o => ({
      value: o._value,
      name: o.__text,
      number: o.__text.match(/\d{3}/) ? o.__text.match(/\d{3}/)[0] : 'all',
    }));
    return values;
  }

  async selectOperationTypes() {
    const operationTypes = await this.takeOperationTypes();
    await this.browser.page.select(
      'select#includeVorgangstyp',
      ...(await this.options.selectOperationTypes(operationTypes)),
    );
  }

  async search() {
    await this.clickWait(this.browser, 'input#btnSuche');
    return this.getResultInfos({ browser: this.browser });
  }

  async getResultInfos({ browser }) {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    await browser.page.waitForSelector('#inhaltsbereich').catch((error) => {
      this.fatalError({ error });
    });
    const resultsNumberString = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#inhaltsbereich',
    );
    const paginator = resultsNumberString.match(reg);
    if (paginator) {
      return {
        pageCurrent: paginator[1],
        pageSum: paginator[2],
        entriesFrom: paginator[3],
        entriesTo: paginator[4],
        entriesSum: paginator[5],
      };
    }
    const error = new Error('Search Pagination not found');
    this.fatalError({ error });
    return null;
  }

  async getEntriesFromSearch() {
    let links = [];
    const resultInfos = await this.getResultInfos({ browser: this.browser });
    await this.options.logStartLinkProgress(resultInfos.pageSum, resultInfos.pageCurrent);
    for (
      let i = parseInt(resultInfos.pageCurrent, 10);
      i <= parseInt(resultInfos.pageSum, 10);
      i += 1
    ) {
      const pageLinks = await Scraper.getEntriesFromPage({
        doScrape: this.options.doScrape,
        browser: this.browser,
      });
      links = links.concat(pageLinks);
      const curResultInfos = await this.getResultInfos({ browser: this.browser });
      await this.options.logUpdateLinkProgress(curResultInfos.pageCurrent);
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await this.clickWait(
          this.browser,
          '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input',
          this.options.logError,
        );
      } else {
        this.options.logStopLinkProgress();
      }
    }
    return links;
  }

  static async getEntriesFromPage({ doScrape, browser }) {
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
          this.fatalError();
          return null;
        }),
    );
    return links.filter(link => doScrape(link));
  }

  static async saveJson(link, page, logData) {
    const processId = /\[ID:&nbsp;(.*?)\]/;
    // const xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    await page.goto(link);

    const content = await page.evaluate(
      sel => document.querySelector(sel).innerHTML,
      '#inhaltsbereich',
    );

    const process = content.match(processId)[1];

    const urlObj = Url.parse(link);
    const queryObj = Querystring.parse(urlObj.query);
    const vorgangId = queryObj.selId;

    const dataProcess = await Scraper.getProcessData(link, page);
    const dataProcessRunning = await Scraper.getProcessRunningData(vorgangId, page);

    const processData = {
      vorgangId,
      ...dataProcess,
      ...dataProcessRunning,
    };
    logData(process, processData);
  }

  static async getProcessData(link, page) {
    const xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    const html = await page.content();
    const xmlString = html.match(xmlRegex)[0].replace('<- VORGANGSABLAUF ->', '');

    return x2j.xml2js(xmlString);
  }

  static async getProcessRunningData(vorgangId, page) {
    await page.goto(`${URLS.processRunning}?vorgangId=${vorgangId}`, {});
    const xmlRegex = /<VORGANGSABLAUF>(.|\n)*?<\/VORGANGSABLAUF>/;
    const html = await page.content();
    const xmlString = html.match(xmlRegex)[0];

    return x2j.xml2js(xmlString);
  }

  async clickWait(browser, selector) {
    try {
      return await Promise.all([
        browser.page.click(selector),
        browser.page.waitForNavigation({
          waitUntil: ['domcontentloaded'],
        }),
        browser.page.waitForSelector('#footer'),
      ]);
    } catch (error) {
      this.options.logError(error);
      return null;
    }
  }
}

module.exports = Scraper;
