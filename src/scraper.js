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
};

class Scraper {
  async scrape({
    stackSize,
    selectedPeriod,
    selectedOperationTypes,
    startLinkProgress,
    updateLinkProgress,
    stopLinkProgress,
    startDataProgress,
    updateDataProgress,
    logLinks,
    logData,
    stopDataProgress,
    finished,
    doScrape,
  }) {
    await this.init();
    const stack = await Promise.all(Scraper.createBrowserStack(stackSize));
    await this.start();
    await this.goToSearch();

    // Select Period
    const periods = await this.takePeriods();
    await this.selectPeriod(await selectedPeriod(periods));
    // Select operationTypes
    const operationTypes = await this.takeOperationTypes();
    await this.selectOperationTypes(await selectedOperationTypes(operationTypes));

    // Search
    /* const resultsInfo = */ await this.search();
    console.log('links1');
    const links = await this.getEntriesFromSearch({
      progressStart: startLinkProgress,
      progressUpdate: updateLinkProgress,
      progressStop: stopLinkProgress,
      doScrape,
    });
    console.log('links2', links);
    await startDataProgress(links.length, Scraper.getErrorCount(stack));

    let completedLinks = 0;
    const analyseLink = async (link, browser /* , logData */) => {
      await Scraper.saveJson(link.url, browser.page, logData).then(() => {
        completedLinks += 1;
        updateDataProgress(completedLinks, Scraper.getErrorCount(stack));
      });
    };
    const startAnalyse = async (browserIndex /* , logLinks, logData */) => {
      const linkIndex = links.findIndex(({ scraped }) => !scraped);
      if (linkIndex !== -1) {
        links[linkIndex].scraped = true;
        await analyseLink(links[linkIndex], stack[browserIndex], logData)
          .then(() => {
            logLinks(links);
          })
          .catch(async (err) => {
            console.log(err);
            stack[browserIndex].errorCount += 1;
            links[linkIndex].scraped = false;
            if (stack[browserIndex].errorCount > 5) {
              await this.createNewBrowser(stack[browserIndex])
                .then((newBrowser) => {
                  stack[browserIndex] = newBrowser;
                  updateDataProgress(completedLinks, Scraper.getErrorCount(stack));
                })
                .catch(err2 => console.log(err2));
            }
          });
        await startAnalyse(browserIndex, logLinks, logData);
      }
    };

    const promises = stack.map(async (browser, browserIndex) => {
      await startAnalyse(browserIndex, logLinks, logData);
    });
    await Promise.all(promises).then(() => {
      stack.forEach(b => b.browser.close());
      stopDataProgress();
      this.finish(finished);
    });
  }

  async init() {
    this.browser = await puppeteer.launch();
    this.page = await this.browser.newPage();

    await this.page.setRequestInterception(true);
    this.page.on('request', (request) => {
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
  }

  static createBrowserStack(number) {
    return [...Array(number)].map(async () => {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      try {
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
          timeout: 60000,
        });
      } catch (error) {
        return new Promise(resolve => resolve());
      }
      return {
        browser,
        page,
        used: false,
        errorCount: 0,
      };
    });
  }

  static getErrorCount(stack) {
    return {
      errorCounter: stack.map(({ errorCount }) => (errorCount < 1 ? errorCount : `${errorCount}`.red)),
    };
  }

  async createNewBrowser(browserObject) {
    // console.log('### create new Browser');
    if (browserObject.browser) {
      await browserObject.browser.close();
    }
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
        timeout: 10000,
      });
      // console.log('new Browser created!');
      return {
        browser,
        page,
        used: false,
        errorCount: 0,
      };
    } catch (error) {
      // console.log('### new Browser failed', error);
      return this.createNewBrowser(browserObject);
    }
  }

  async start() {
    await this.page.goto(URLS.start);
  }

  async goToSearch() {
    await this.clickWait('#navigationMenu > ul > li:nth-child(4) > ul > li:nth-child(2) > div > a');
  }

  async takePeriods() {
    await this.page.waitForSelector('input#btnSuche', { timeout: 5000 });
    const selectField = await this.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#wahlperiode',
    );
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  async selectPeriod(period) {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
      this.page.select('select#wahlperiode', period),
    ]);
  }

  async takeOperationTypes() {
    const selectField = await this.page.evaluate(
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

  async selectOperationTypes(operationTypes) {
    await this.page.select('select#includeVorgangstyp', ...operationTypes);
  }

  async search() {
    await this.clickWait('input#btnSuche');
    return this.getResultInfos();
  }

  async getResultInfos() {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    this.page.waitForSelector('#inhaltsbereich');
    const resultsNumberString = await this.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#inhaltsbereich',
    );
    const paginator = resultsNumberString.match(reg);
    return {
      pageCurrent: paginator[1],
      pageSum: paginator[2],
      entriesFrom: paginator[3],
      entriesTo: paginator[4],
      entriesSum: paginator[5],
    };
  }

  async getEntriesFromSearch({
    progressStart, progressUpdate, progressStop, doScrape,
  }) {
    let links = [];
    const resultInfos = await this.getResultInfos();
    await progressStart(resultInfos.pageSum, resultInfos.pageCurrent);
    for (
      let i = parseInt(resultInfos.pageCurrent, 10);
      i <= parseInt(resultInfos.pageSum, 10);
      i += 1
    ) {
      const pageLinks = await this.getEntriesFromPage({ doScrape });
      links = links.concat(pageLinks);
      const curResultInfos = await this.getResultInfos();
      await progressUpdate(curResultInfos.pageCurrent);
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await this.clickWait('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input');
      } else {
        progressStop();
      }
    }
    return links;
  }

  async getEntriesFromPage({ doScrape }) {
    const links = await this.page.$$eval(
      '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody > tr',
      els =>
        els.map(el => ({
          id: el.querySelector('a.linkIntern').href.match(/selId=(\d.*?)&/)[1],
          url: el.querySelector('a.linkIntern').href,
          date: el.querySelector('td:nth-child(4)').innerHTML,
          scraped: false,
        })),
    );
    return links.filter(link => doScrape(link));
  }

  async selectFirstEntry() {
    try {
      const href = await this.page.$eval(
        '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody > tr:nth-child(1) > td:nth-child(3) > a',
        el => el.href,
      );
      await this.page.goto(href, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      console.log(error);
    }
  }

  async goToNextEntry() {
    await this.clickWait('#inhaltsbereich > div.inhalt > div.contentBox > fieldset > fieldset > div > fieldset > div > div.navigationListeNachRechts > input');
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
    // await this.getCoAdvisedOperationsData(vorgangId, page);

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

  async getCoAdvisedOperationsData(vorgangId /* , page */) {
    // #nocss1 > fieldset > div > ul
    const tabLength = await this.page.evaluate(() => document.querySelectorAll('#nocss1 > fieldset > div > ul a').length);
    if (tabLength > 1) {
      console.log(`#+#+#+#+#+#+#+#+#+#+#+#+#+# vorgangId: ${vorgangId}`);
    }
  }

  /* async screenshot(path, page = this.page) {
    let height = await this.page.evaluate(
      () => document.documentElement.offsetHeight
    );
    await page.setViewport({ width: 1000, height: height });
    await page.screenshot({ path });
  } */

  async clickWait(selector) {
    try {
      return await Promise.all([
        this.page.click(selector),
        this.page.waitForNavigation({
          waitUntil: ['domcontentloaded'],
        }),
        this.page.waitForSelector('#footer'),
      ]);
    } catch (error) {
      console.log('TIMEOUT');
      return null;
    }
  }

  async finish(finished) {
    await this.browser.close();
    finished();
  }
}

module.exports = Scraper;
