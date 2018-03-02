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
    let vorgangstyp = this.getSelectOptions({
      $,
      selector: '#ProceduresSimpleSearchForm #includeVorgangstyp',
    });

    vorgangstyp = vorgangstyp.map(e => ({
      ...e,
      number: e.name.split(' - ')[0],
    }));

    return {
      wahlperioden,
      vorgangstyp,
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
    const $ = cheerio.load(body);
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    const paginator = $('#inhaltsbereich')
      .html()
      .match(reg);
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
    const entries = $('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody tr').find($('a.linkIntern'));
    return _.map(entries, entry => entry.attribs.href);
  };
}

export default DipBrowser;

// (async () => {
//   const browser = new DipBrowser();
//   await browser.initialize();

//   const searchBody = await browser.getBeratungsablaeufeSearchPage();

//   /* Only get possible filter Data  */
//   // const searchOptions = await browser.getBeratungsablaeufeSearchOptions({
//   //   body: searchBody
//   // });
//   //   console.log(searchOptions);

//   const { formData, formMethod, formAction } = await browser.getBeratungsablaeufeSearchFormData({
//     body: searchBody,
//   });

//   /* suchoptionen einstellen */
//   formData.wahlperiode = '';
//   formData.method = 'Suchen';
//   formData.anzahlTreffer = 2;

//   const { body: searchResultBody } = await browser.getSearchResultPage({
//     formMethod,
//     formAction,
//     formData,
//   });

//   const resultInfo = await browser.getResultInfo({ body: searchResultBody });
//   console.log(resultInfo);

//   let entries = [];
//   entries = [...entries, ...browser.getEntries({ body: searchResultBody })];
//   // console.log(entries);
// })();
