import fs from 'fs';

const request = require('request');
const cheerio = require('cheerio');
const _ = require('lodash');

class DipBrowser {
  dipUrl = 'https://dipbt.bundestag.de';
  startUrl = '/dip21.web/bt';
  cookie = null;

  constructor() {
    this.cookie = request.jar();
  }

  initialize = async () => {
    await this.request({
      ...this.defReqOpt,
      uri: this.startUrl,
    });
  };

  request = (opts) => {
    const reqOptions = {
      timeout: 10000,
      method: 'GET',
      jar: this.cookie,
      ...opts,
    };

    if (reqOptions.uri.substr(0, 4) !== 'http') {
      reqOptions.uri = `${this.dipUrl}${reqOptions.uri}`;
    }

    return new Promise((resolve, reject) => {
      request(reqOptions, (error, res, body) => {
        if (!error && res.statusCode === 200) {
          resolve({ res, body });
        } else {
          reject(error);
        }
      });
    });
  };

  getBeratungsablaeufeSearchPage = async () => {
    const { body } = await this.request({
      uri: '/dip21.web/searchProcedures.do',
    });
    return body;
  };

  getSelectOptions = ({ selectHtml }) => {
    const optionMatches = selectHtml.match(/<option.*?>.*?<\/option>/g).map((o) => {
      const oMatches = o.match(/<option.*?value="(.*?)".*?>(.*?)<\/option>/);
      return {
        name: oMatches[2],
        value: oMatches[1],
      };
    });
    return optionMatches;
  };

  getBeratungsablaeufeSearchOptions = async ({ body }) => {
    const periodMatches = body.match(/<select name="wahlperiode".*?>(.|\s)*?<\/select>/);
    const periods = this.getSelectOptions({
      selectHtml: periodMatches[0],
    });

    const operationTypesMatches = body.match(/<select name="vorgangstyp".*?>(.|\s)*?<\/select>/);
    let operationTypes = this.getSelectOptions({
      selectHtml: operationTypesMatches[0],
    });
    operationTypes = operationTypes.map(e => ({
      ...e,
      number: e.name.split(' - ')[0],
    }));
    return {
      wahlperioden: periods,
      vorgangstyp: operationTypes,
    };
  };

  getBeratungsablaeufeSearchFormData = async ({ body }) => {
    const $ = cheerio.load(body);
    const formData = $('#ProceduresSimpleSearchForm')
      .serializeArray()
      .reduce((obj, { name, value }) => ({ ...obj, [name]: value }), {});
    const searchForm = $('#ProceduresSimpleSearchForm');
    return {
      formData,
      formMethod: searchForm.attr('method'),
      formAction: searchForm.attr('action'),
    };
  };

  getSearchResultPage = async ({ formMethod, formAction, formData }) =>
    this.request({
      method: formMethod,
      uri: formAction,
      form: formData,
    });

  getResultInfo = async ({ body }) => {
    if (body.includes('Es konnte kein Datensatz gefunden werden.')) {
      return false;
    }
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    const paginator = body.match(reg);
    if (!paginator) {
      return 'isEntry';
    }
    return {
      pageCurrent: _.toInteger(paginator[1]),
      pageSum: _.toInteger(paginator[2]),
      entriesFrom: _.toInteger(paginator[3]),
      entriesTo: _.toInteger(paginator[4]),
      entriesSum: _.toInteger(paginator[5]),
    };
  };

  getEntries = ({ body }) => {
    const $ = cheerio.load(body);
    const entries = $('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody tr');

    return _.map(entries, (entry) => {
      const { href } = $(entry).find($('a.linkIntern'))[0].attribs;
      const date = $(entry)
        .find($('td:nth-child(4)'))
        .text();
      return {
        id: href.match(/selId=(\d.*?)&/)[1],
        url: href,
        date,
        scraped: false,
      };
    });
  };
}

export default DipBrowser;
