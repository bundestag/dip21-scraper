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

  getSelectOptions = ({ $, selector }) =>
    _.map($(selector).children(), ({ children, attribs: { value } }) => ({
      name: children[0].data,
      value,
    }));

  getBeratungsablaeufeSearchOptions = async ({ body }) => {
    const $ = cheerio.load(body);
    const wahlperioden = this.getSelectOptions({
      $,
      selector: '#ProceduresSimpleSearchForm #wahlperiode',
    });
    const vorgangstyp = this.getSelectOptions({
      $,
      selector: '#ProceduresSimpleSearchForm #includeVorgangstyp',
    });
    return {
      wahlperioden,
      vorgangstyp,
    };
  };

  getBeratungsablaeufeSearchFormData = async ({ body }) => {
    const $ = cheerio.load(body);
    return $('#ProceduresSimpleSearchForm')
      .serializeArray()
      .reduce((obj, { name, value }) => ({ ...obj, [name]: value }), {});
  };

  getFirstSearchResultPage = async ({ body, searchData }) => {
    const $ = cheerio.load(body);
    const searchForm = $('#ProceduresSimpleSearchForm');
    return this.request({
      method: searchForm.attr('method'),
      uri: searchForm.attr('action'),
      form: searchData,
    });
  };

  getEntries = ({ body }) => {
    const $ = cheerio.load(body);
    const entries = $('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody tr').find($('a.linkIntern'));
    return _.map(entries, entry => entry.attribs.href);
  };
}

(async () => {
  const browser = new DipBrowser();
  await browser.initialize();

  const searchBody = await browser.getBeratungsablaeufeSearchPage();

  /* Only get possible filter Data  */
  //   const searchOptions = await browser.getBeratungsablaeufeSearchOptions({ body: searchBody });
  //   console.log(searchOptions);

  const searchData = await browser.getBeratungsablaeufeSearchFormData({ body: searchBody });

  /* suchoptionen einstellen */
  searchData.wahlperiode = '';
  searchData.method = 'Suchen';
  searchData.anzahlTreffer = 200;

  const { body: searchResult } = await browser.getFirstSearchResultPage({
    body: searchBody,
    searchData,
  });

  let entries = [];
  entries = [...entries, ...browser.getEntries({ body: searchResult })];
  console.log(entries);
})();
