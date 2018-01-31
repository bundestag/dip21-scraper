const puppeteer = require("puppeteer");
const X2JS = require("x2js");
const jsonfile = require("jsonfile");
var _progress = require("cli-progress");
const fs = require("fs-extra");

const x2j = new X2JS();

class Scraper {
  async init() {
    this.browser = await puppeteer.launch();
    this.page = await this.browser.newPage();
  }

  async start() {
    await this.page.goto("https://dipbt.bundestag.de/dip21.web/bt");
  }

  async goToSearch() {
    await this.clickWait(
      "#navigationMenu > ul > li:nth-child(4) > ul > li:nth-child(1) > div > a"
    );
  }

  async takePeriods() {
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

  async getEntriesFromSearch() {
    let links = [];
    const resultInfos = await this.getResultInfos();
    console.log("get Links");
    var bar1 = new _progress.Bar({}, _progress.Presets.shades_classic);
    bar1.start(resultInfos.pageSum, resultInfos.pageCurrent);
    for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i++) {
      let pageLinks = await this.getEntriesFromPage();
      links = links.concat(pageLinks);
      let curResultInfos = await this.getResultInfos();
      bar1.update(curResultInfos.pageCurrent);
      if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
        await this.clickWait(
          "#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input"
        );
      } else {
        bar1.stop();
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

  async saveJson(link, index) {
    let page = await this.browser.newPage();
    var processId = /\[ID:&nbsp;(.*?)\]/;
    var xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    await page.goto(link);
    let content = await page.evaluate(sel => {
      return document.querySelector(sel).innerHTML;
    }, "#inhaltsbereich");

    let process = content.match(processId)[1];

    let html = await page.content();
    let xmlString = html.match(xmlRegex)[0].replace("<- VORGANGSABLAUF ->", "");

    var data = x2j.xml2js(xmlString);
    let processData = {
      process,
      ...data
    };
    const directory = `files/${processData.VORGANG.WAHLPERIODE}/${
      processData.VORGANG.VORGANGSTYP
    }`;
    await fs.ensureDir(directory);
    await jsonfile.writeFile(
      `${directory}/${process}.json`,
      processData,
      {
        spaces: 2,
        EOL: "\r\n"
      },
      err => {}
    );
    await page.close();
  }

  async screenshot(path, page = this.page) {
    let height = await this.page.evaluate(
      () => document.documentElement.offsetHeight
    );
    await page.setViewport({ width: 1000, height: height });
    await page.screenshot({ path });
  }

  async clickWait(selector) {
    try {
      return await Promise.all([
        this.page.waitForNavigation({
          waitUntil: ["domcontentloaded"]
        }),
        this.page.click(selector)
      ]);
    } catch (error) {
      console.log("TIMEOUT");
    }
  }

  async finish() {
    await this.browser.close();
  }
}

module.exports = Scraper;
