const puppeteer = require("puppeteer");
const X2JS = require("x2js");
const Url = require("url");
const Querystring = require("querystring");

const x2j = new X2JS();

const URLS = {
  basisInfos:
    "https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail.do",
  processRunning:
    "https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail_vp.do",
  start: "https://dipbt.bundestag.de/dip21.web/bt"
};

class Scraper {
  async scrape(options) {
    await this.init();
    const stack = await Promise.all(this.createBrowserStack(options.stackSize));
    await this.start();
    await this.goToSearch();

    //Select Period
    const periods = await this.takePeriods();
    await this.selectPeriod(await options.selectedPeriod(periods));
    //Select operationTypes
    const operationTypes = await this.takeOperationTypes();
    await this.selectOperationTypes(
      await options.selectedOperationTypes(operationTypes)
    );

    //Search
    const resultsInfo = await this.search();
    let links = await this.getEntriesFromSearch(
      options.startLinkProgress,
      options.updateLinkProgress,
      options.stopLinkProgress
    );
    await options.startDataProgress(
      resultsInfo.entriesSum,
      this.getErrorCount(stack)
    );

    let completedLinks = 0;
    const analyseLink = async (link, browser, logData) => {
      await this.saveJson(link.url, browser.page, logData).then(() => {
        completedLinks += 1;
        options.updateDataProgress(completedLinks, this.getErrorCount(stack));
      });
    };
    const startAnalyse = async (browserIndex, logLinks, logData) => {
      const linkIndex = links.findIndex(({ scraped }) => !scraped);
      if (linkIndex !== -1) {
        links[linkIndex].scraped = true;
        await analyseLink(links[linkIndex], stack[browserIndex], logData)
          .then(() => {
            logLinks(links);
          })
          .catch(async err => {
            console.log(err);
            stack[browserIndex].errorCount += 1;
            links[linkIndex].scraped = false;
            if (stack[browserIndex].errorCount > 5) {
              await this.createNewBrowser(stack[browserIndex])
                .then(newBrowser => {
                  stack[browserIndex] = newBrowser;
                  options.updateDataProgress(
                    completedLinks,
                    this.getErrorCount(stack)
                  );
                })
                .catch(err => log.error(err));
            }
          });
        await startAnalyse(browserIndex, options.logLinks, options.logData);
      }
    };

    const promises = stack.map(async (browser, browserIndex) => {
      await startAnalyse(browserIndex, options.logLinks, options.logData);
    });
    await Promise.all(promises).then(() => {
      stack.forEach(b => b.browser.close());
      options.stopDataProgress();
      this.finish(options.finished);
    });
  }

  async init() {
    this.browser = await puppeteer.launch();
    this.page = await this.browser.newPage();

    await this.page.setRequestInterception(true);
    this.page.on("request", request => {
      switch (request.resourceType()) {
        case "image":
        case "script":
        case "stylesheet":
          request.abort();
          break;

        default:
          request.continue();
          break;
      }
    });
  }

  createBrowserStack(number) {
    return [...Array(number)].map(async () => {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      try {
        await page.setRequestInterception(true);
        page.on("request", request => {
          switch (request.resourceType()) {
            case "image":
            case "script":
            case "stylesheet":
              request.abort();
              break;

            default:
              request.continue();
              break;
          }
        });
        await page.goto(URLS.start, {
          timeout: 60000
        });
      } catch (error) {
        return new Promise(resolve => resolve());
      }
      return {
        browser,
        page,
        used: false,
        errorCount: 0
      };
    });
  }

  getErrorCount(stack) {
    return {
      errorCounter: stack.map(
        ({ errorCount }) => (errorCount < 1 ? errorCount : `${errorCount}`.red)
      )
    };
  }

  async createNewBrowser(browserObject) {
    // console.log("### create new Browser");
    if (browserObject.browser) {
      await browserObject.browser.close();
    }
    try {
      let browser = await puppeteer.launch();
      let page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", request => {
        switch (request.resourceType()) {
          case "image":
          case "script":
          case "stylesheet":
            request.abort();
            break;

          default:
            request.continue();
            break;
        }
      });
      await page.goto(URLS.start, {
        timeout: 10000
      });
      // console.log("new Browser created!");
      return {
        browser,
        page,
        used: false,
        errorCount: 0
      };
    } catch (error) {
      // console.log("### new Browser failed", error);
      return await this.createNewBrowser(browserObject);
    }
  }

  async start() {
    await this.page.goto(URLS.start);
  }

  async goToSearch() {
    await this.clickWait(
      "#navigationMenu > ul > li:nth-child(4) > ul > li:nth-child(2) > div > a"
    );
  }

  async takePeriods() {
    await this.page.waitForSelector("input#btnSuche", { timeout: 5000 });
    const selectField = await this.page.evaluate(sel => {
      return document.querySelector(sel).outerHTML;
    }, "#wahlperiode");
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  async selectPeriod(period) {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: ["domcontentloaded"] }),
      this.page.select("select#wahlperiode", period)
    ]);
  }

  async takeOperationTypes() {
    const selectField = await this.page.evaluate(sel => {
      return document.querySelector(sel).outerHTML;
    }, "#includeVorgangstyp");
    const values = x2j
      .xml2js(selectField)
      .select.option.map(o => ({ value: o._value, name: o.__text }));
    return values;
  }

  async selectOperationTypes(operationTypes) {
    await this.page.select("select#includeVorgangstyp", ...operationTypes);
  }

  async search() {
    await this.clickWait("input#btnSuche");
    return this.getResultInfos();
  }

  async getResultInfos() {
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    this.page.waitForSelector("#inhaltsbereich");
    const resultsNumberString = await this.page.evaluate(sel => {
      return document.querySelector(sel).outerHTML;
    }, "#inhaltsbereich");
    const paginator = resultsNumberString.match(reg);
    return {
      pageCurrent: paginator[1],
      pageSum: paginator[2],
      entriesFrom: paginator[3],
      entriesTo: paginator[4],
      entriesSum: paginator[5]
    };
  }

  async getEntriesFromSearch(progressStart, progressUpdate, progressStop) {
    let links = [];
    const resultInfos = await this.getResultInfos();
    await progressStart(resultInfos.pageSum, resultInfos.pageCurrent);
    for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i++) {
      let pageLinks = await this.getEntriesFromPage();
      links = links.concat(pageLinks);
      let curResultInfos = await this.getResultInfos();
      await progressUpdate(curResultInfos.pageCurrent);
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await this.clickWait(
          "#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input"
        );
      } else {
        progressStop();
      }
    }
    return links;
  }

  async getEntriesFromPage() {
    return await this.page.$$eval(
      "#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody a.linkIntern",
      els => els.map(el => ({ url: el.href, scraped: false }))
    );
  }

  async selectFirstEntry() {
    try {
      const href = await this.page.$eval(
        "#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody > tr:nth-child(1) > td:nth-child(3) > a",
        el => el.href
      );
      await this.page.goto(href, { waitUntil: "domcontentloaded" });
    } catch (error) {}
  }

  async goToNextEntry() {
    await this.clickWait(
      "#inhaltsbereich > div.inhalt > div.contentBox > fieldset > fieldset > div > fieldset > div > div.navigationListeNachRechts > input"
    );
  }

  async saveJson(link, page, logData) {
    var processId = /\[ID:&nbsp;(.*?)\]/;
    var xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    await page.goto(link);

    let content = await page.evaluate(sel => {
      return document.querySelector(sel).innerHTML;
    }, "#inhaltsbereich");

    let process = content.match(processId)[1];

    const urlObj = Url.parse(link);
    const queryObj = Querystring.parse(urlObj.query);
    const vorgangId = queryObj.selId;

    var dataProcess = await this.getProcessData(link, page);
    var dataProcessRunning = await this.getProcessRunningData(vorgangId, page);
    //await this.getCoAdvisedOperationsData(vorgangId, page);

    let processData = {
      vorgangId,
      ...dataProcess,
      ...dataProcessRunning
    };
    logData(process, processData);
  }

  async getProcessData(link, page) {
    var xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    let html = await page.content();
    let xmlString = html.match(xmlRegex)[0].replace("<- VORGANGSABLAUF ->", "");

    return x2j.xml2js(xmlString);
  }

  async getProcessRunningData(vorgangId, page) {
    await page.goto(`${URLS.processRunning}?vorgangId=${vorgangId}`, {});
    var xmlRegex = /<VORGANGSABLAUF>(.|\n)*?<\/VORGANGSABLAUF>/;
    let html = await page.content();
    let xmlString = html.match(xmlRegex)[0];

    return x2j.xml2js(xmlString);
  }

  async getCoAdvisedOperationsData(vorgangId, page) {
    // #nocss1 > fieldset > div > ul
    const tabLength = await this.page.evaluate(sel => {
      return document.querySelectorAll("#nocss1 > fieldset > div > ul a")
        .length;
    });
    if (tabLength > 1) {
      console.log(`#+#+#+#+#+#+#+#+#+#+#+#+#+# vorgangId: ${vorgangId}`);
    }
  }

  /*async screenshot(path, page = this.page) {
    let height = await this.page.evaluate(
      () => document.documentElement.offsetHeight
    );
    await page.setViewport({ width: 1000, height: height });
    await page.screenshot({ path });
  }*/

  async clickWait(selector) {
    try {
      return await Promise.all([
        this.page.click(selector),
        this.page.waitForNavigation({
          waitUntil: ["domcontentloaded"]
        }),
        this.page.waitForSelector("#footer")
      ]);
    } catch (error) {
      console.log("TIMEOUT");
    }
  }

  async finish(finished) {
    await this.browser.close();
    finished();
  }
}

module.exports = Scraper;
