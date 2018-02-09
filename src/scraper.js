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
    selectPeriod = () => '',
    selectOperationTypes = () => '',
    logStartLinkProgress = () => {},
    logUpdateLinkProgress = () => {},
    logStopLinkProgress = () => {},
    logStartDataProgress = () => {},
    logUpdateDataProgress = () => {},
    logStopDataProgress = () => {},
    logFinished = () => {},
    logError = () => {},
    outScraperLinks = () => {},
    outScraperData = () => {},
    doScrape = () => true,
    browserStackSize = () => 1,
  }) {
    // Error on browserStackSize <= 0
    const stack = await Promise.all(Scraper.createBrowserStack(browserStackSize()));
    await Scraper.start(stack[0]);
    await Scraper.goToSearch(stack[0]);

    // Select Period
    const periods = await Scraper.takePeriods(stack[0]);
    await Scraper.selectPeriod(stack[0], await selectPeriod(periods));
    // Select operationTypes
    const operationTypes = await Scraper.takeOperationTypes(stack[0]);
    await Scraper.selectOperationTypes(stack[0], await selectOperationTypes(operationTypes));

    // Search
    await Scraper.search(stack[0], logError);
    const links = await Scraper.getEntriesFromSearch({
      logStartLinkProgress,
      logUpdateLinkProgress,
      logStopLinkProgress,
      logError,
      doScrape,
      browser: stack[0],
    });
    await logStartDataProgress(links.length, Scraper.getErrorCount(stack));

    let completedLinks = 0;
    const analyseLink = async (link, browser) => {
      await Scraper.saveJson(link.url, browser.page, outScraperData).then(() => {
        completedLinks += 1;
        logUpdateDataProgress(completedLinks, Scraper.getErrorCount(stack));
      });
    };
    const startAnalyse = async (browserIndex) => {
      const linkIndex = links.findIndex(({ scraped }) => !scraped);
      if (linkIndex !== -1) {
        links[linkIndex].scraped = true;
        await analyseLink(links[linkIndex], stack[browserIndex], outScraperData)
          .then(() => {
            outScraperLinks(links);
          })
          .catch(async (err) => {
            logError(err);
            stack[browserIndex].errorCount += 1;
            links[linkIndex].scraped = false;
            if (stack[browserIndex].errorCount > 5) {
              await this.createNewBrowser(stack[browserIndex])
                .then((newBrowser) => {
                  stack[browserIndex] = newBrowser;
                  logUpdateDataProgress(completedLinks, Scraper.getErrorCount(stack));
                })
                .catch(err2 => logError(err2));
            }
          });
        await startAnalyse(browserIndex, outScraperLinks, outScraperData);
      }
    };

    const promises = stack.map(async (browser, browserIndex) => {
      await startAnalyse(browserIndex, outScraperLinks, outScraperData);
    });
    await Promise.all(promises).then(() => {
      stack.forEach(b => b.browser.close());
      logStopDataProgress();
      logFinished();
    });
  }

  static createBrowserStack(number) {
    return [...Array(number)].map(Scraper.createNewBrowser);
  }

  static getErrorCount(stack) {
    return {
      errorCounter: stack.map(({ errorCount }) => (errorCount < 1 ? errorCount : `${errorCount}`.red)),
    };
  }

  static async createNewBrowser(browserObject = {}) {
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
      return Scraper.createNewBrowser(browserObject);
    }
  }

  static async start(browser) {
    await browser.page.goto(URLS.start);
  }

  static async goToSearch(browser) {
    const cookies = await browser.page.cookies();
    const jssessionCookie = cookies.filter(c => c.name === 'JSESSIONID');
    await browser.page.goto(`https://dipbt.bundestag.de/dip21.web/searchProcedures.do;jsessionid=${
      jssessionCookie.value
    }`);
  }

  static async takePeriods(browser) {
    await browser.page.waitForSelector('input#btnSuche', { timeout: 5000 });
    const selectField = await browser.page.evaluate(
      sel => document.querySelector(sel).outerHTML,
      '#wahlperiode',
    );
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  static async selectPeriod(browser, period) {
    await Promise.all([
      browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
      browser.page.select('select#wahlperiode', period),
    ]);
  }

  static async takeOperationTypes(browser) {
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
  }

  static async selectOperationTypes(browser, operationTypes) {
    await browser.page.select('select#includeVorgangstyp', ...operationTypes);
  }

  static async search(browser, logError) {
    await Scraper.clickWait(browser, 'input#btnSuche', logError);
    return Scraper.getResultInfos({ browser });
  }

  static async getResultInfos({ browser }) {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    browser.page.waitForSelector('#inhaltsbereich');
    const resultsNumberString = await browser.page.evaluate(
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

  static async getEntriesFromSearch({
    logStartLinkProgress,
    logUpdateLinkProgress,
    logStopLinkProgress,
    doScrape,
    logError,
    browser,
  }) {
    let links = [];
    const resultInfos = await Scraper.getResultInfos({ browser });
    await logStartLinkProgress(resultInfos.pageSum, resultInfos.pageCurrent);
    for (
      let i = parseInt(resultInfos.pageCurrent, 10);
      i <= parseInt(resultInfos.pageSum, 10);
      i += 1
    ) {
      const pageLinks = await Scraper.getEntriesFromPage({ doScrape, browser });
      links = links.concat(pageLinks);
      const curResultInfos = await Scraper.getResultInfos({ browser });
      await logUpdateLinkProgress(curResultInfos.pageCurrent);
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await Scraper.clickWait(
          browser,
          '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input',
          logError,
        );
      } else {
        logStopLinkProgress();
      }
    }
    return links;
  }

  static async getEntriesFromPage({ doScrape, browser }) {
    const links = await browser.page.$$eval(
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

  static async clickWait(browser, selector, logError) {
    try {
      return await Promise.all([
        browser.page.click(selector),
        browser.page.waitForNavigation({
          waitUntil: ['domcontentloaded'],
        }),
        browser.page.waitForSelector('#footer'),
      ]);
    } catch (error) {
      logError(error);
      return null;
    }
  }
}

module.exports = Scraper;
