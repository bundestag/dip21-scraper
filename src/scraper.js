const puppeteer = require("puppeteer");
const X2JS = require("x2js");
const jsonfile = require("jsonfile");

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
    const reg = /von (\d*)\)/;
    await this.clickWait("input#btnSuche");
    const resultsNumberString = await this.page.evaluate(sel => {
      return document.querySelector(sel).outerHTML;
    }, "#inhaltsbereich");
    return resultsNumberString.match(reg)[1];
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

  async saveJson() {
    var processId = /\[ID:&nbsp;(.*?)\]/;
    var xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
    let content = await this.page.evaluate(sel => {
      return document.querySelector(sel).innerHTML;
    }, "#inhaltsbereich");

    const process = content.match(processId)[1];

    const html = await this.page.content();
    const xmlString = html
      .match(xmlRegex)[0]
      .replace("<- VORGANGSABLAUF ->", "");

    var data = x2j.xml2js(xmlString);
    const processData = {
      process,
      ...data
    };
    await jsonfile.writeFile(
      `files/${process}.json`,
      processData,
      {
        spaces: 2,
        EOL: "\r\n"
      },
      err => {}
    );
  }

  async screenshot() {
    await this.page.screenshot({ path: `screenshot.png` });
  }

  async clickWait(selector) {
    try {
      return await Promise.all([
        this.page.waitForNavigation({
          timeout: 300000,
          waitUntil: ["networkidle2", "domcontentloaded"]
        }),
        this.page.click(selector)
      ]);
    } catch (error) {
      await this.page.goBack({
        timeout: 300000,
        waitUntil: ["domcontentloaded"]
      });
      await this.clickWait(selector);
    }
  }

  async finish() {
    await this.browser.close();
  }
}

module.exports = Scraper;
