const puppeteer = require('puppeteer');
const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');

const x2j = new X2JS();

const URLS = {
  basisInfos: 'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail.do',
  processRunning:
    'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail_vp.do?vorgangId=',
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
    timeoutStart: () => 30000,
    timeoutSearch: () => 30000,
    timeoutProcedure: () => 30000,
    maxRetries: () => 20,
  };

  async scrape(options) {
    this.options = { ...this.defaultOptions, ...options };
    this.retries = -this.options.browserStackSize();
    this.stack = await Promise.all(this.createBrowserStack());
    this.browser = await this.stack.find(() => true); // Main Browser from the stack
    await this.goToSearch();

    // Select Period & operationTypes
    await this.selectPeriod();
    await this.selectOperationTypes();

    // Search
    this.links = await this.search();

    // Data
    this.completedLinks = 0;
    await this.options.logStartDataProgress({
      sum: this.links.length,
      retries: this.retries,
      maxRetries: this.options.maxRetries,
    });
    await Promise.all(this.stack.map(async (browser, browserIndex) => {
      await this.startAnalyse(browserIndex);
    })).then(() => {
      // Finalize
      this.options.logStopDataProgress();
      this.finalize();
      this.options.logFinished();
    });
  }

  async startAnalyse(browserIndex) {
    const linkIndex = this.links.findIndex(({ scraped }) => !scraped);
    if (linkIndex !== -1) {
      this.links[linkIndex].scraped = true;
      await this.saveJson({ link: this.links[linkIndex].url, page: this.stack[browserIndex].page })
        .then(() => {
          this.completedLinks += 1;
          this.options.outScraperLinks({ links: this.links });
          this.options.logUpdateDataProgress({
            value: this.completedLinks,
            retries: this.retries,
            maxRetries: this.options.maxRetries,
          });
        })
        .catch(async (error) => {
          this.options.logError({ error });
          this.links[linkIndex].scraped = false;
          await this.createNewBrowser({ browserObject: this.stack[browserIndex] })
            .then((newBrowser) => {
              this.stack[browserIndex] = newBrowser;
              this.options.logUpdateDataProgress({
                value: this.completedLinks,
                retries: this.retries,
                maxRetries: this.options.maxRetries,
              });
            })
            .catch(err => this.fatalError({ error: err }));
        });
      await this.startAnalyse(browserIndex);
    }
  }

  finalize() {
    if (this.stack) {
      this.stack.forEach(b => b.browser.close());
    }
  }

  fatalError({ error }) {
    this.options.logFatalError({ error });
    this.options.logStopLinkProgress();
    this.options.logStopDataProgress();
    this.finalize();
    throw error;
  }

  createBrowserStack() {
    return [...Array(this.options.browserStackSize())].map(browserObject =>
      this.createNewBrowser({ browserObject }));
  }

  async createNewBrowser({ browserObject = {} }) {
    if (browserObject.browser) {
      await browserObject.browser.close();
    }
    if (this.options.maxRetries() <= this.retries) {
      const error = new Error(`Maximum Retries reached ${this.retries}/${this.options.maxRetries()}`);
      this.fatalError({ error }); // throws
    }
    this.retries += 1;
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
      };
    } catch (error) {
      return this.createNewBrowser({ browserObject });
    }
  }

  async goToSearch() {
    const cookies = await this.browser.page.cookies();
    const jssessionCookie = cookies.filter(c => c.name === 'JSESSIONID');
    await this.browser.page.goto(URLS.search + jssessionCookie[0].value, {
      timeout: this.options.timeoutSearch(),
    }).catch((error) => {
      this.fatalError({ error });
    });
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
    ).catch((error) => {
      this.fatalError({ error });
    });
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  async selectPeriod() {
    const periods = await this.takePeriods();
    await Promise.all([
      this.browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
      this.browser.page.select('select#wahlperiode', await this.options.selectPeriod({ periods })),
    ]);
  }

  async takeOperationTypes() {
    const selectField = await this.browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#includeVorgangstyp',
    ).catch((error) => {
      this.fatalError({ error });
    });
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
      ...(await this.options.selectOperationTypes({ operationTypes })),
    );
  }

  async getResultInfos({ browser }) {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    await browser.page.waitForSelector('#inhaltsbereich').catch((error) => {
      this.fatalError({ error });
    });
    const resultsNumberString = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#inhaltsbereich',
    ).catch((error) => {
      this.fatalError({ error });
    });
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

  async search() {
    await this.clickWait({ browser: this.browser, selector: 'input#btnSuche' });
    let links = [];
    const resultInfos = await this.getResultInfos({ browser: this.browser })
      .catch((error) => { this.fatalError(error); });
    await this.options.logStartLinkProgress({
      sum: resultInfos.pageSum,
      value: resultInfos.pageCurrent,
    });
    for (
      let i = parseInt(resultInfos.pageCurrent, 10);
      i <= parseInt(resultInfos.pageSum, 10);
      i += 1
    ) {
      const pageLinks = await this.getEntriesFromPage({
        browser: this.browser,
      });
      links = links.concat(pageLinks);
      const curResultInfos = await this.getResultInfos({ browser: this.browser })
        .catch((error) => { this.fatalError(error); });
      await this.options.logUpdateLinkProgress({ value: curResultInfos.pageCurrent });
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await this.clickWait({
          browser: this.browser,
          selector:
            '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input',
        });
      } else {
        this.options.logStopLinkProgress();
      }
    }
    return links;
  }

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
          this.fatalError({ error });
          return null;
        }),
    );
    return links.filter(link => this.options.doScrape({ data: link }));
  }

  async saveJson({ link, page }) {
    const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
    await page.goto(link, {
      timeout: this.options.timeoutProcedure(),
    }).catch((error) => {
      this.fatalError({ error });
    });

    const content = await page.evaluate(
      sel => document.querySelector(sel).innerHTML,
      '#inhaltsbereich',
    );

    const procedureId = content.match(procedureIdRegex)[1];

    const urlObj = Url.parse(link);
    const queryObj = Querystring.parse(urlObj.query);
    const vorgangId = queryObj.selId;
    if (procedureId.substring(3) !== vorgangId) {
      const error = new Error(`Procedure ID missmatch URL: "${vorgangId}" to HTML: "${procedureId.substring(3)}"`);
      this.fatalError({ error });
    }

    const dataProcedure = await Scraper.getProcedureData({ page }).catch((error) => {
      this.fatalError(error);
    });
    await page.goto(`${URLS.processRunning}${vorgangId}`, {
      timeout: this.options.timeoutProcedure(),
    }).catch((error) => {
      this.fatalError({ error });
    });
    const dataProcedureRunning = await Scraper.getProcedureRunningData({ page }).catch((error) => {
      this.fatalError({ error });
    });

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
    const xmlString = html.match(xmlRegex)[0];
    return x2j.xml2js(xmlString);
  }

  async clickWait({ browser, selector }) {
    try {
      return await Promise.all([
        browser.page.click(selector),
        browser.page.waitForNavigation({
          waitUntil: ['domcontentloaded'],
        }),
        browser.page.waitForSelector('#footer'),
      ]);
    } catch (error) {
      this.options.logError({ error });
      return null;
    }
  }
}

module.exports = Scraper;
