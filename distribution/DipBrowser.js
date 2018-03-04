'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const request = require('request');
const cheerio = require('cheerio');
const _ = require('lodash');

class DipBrowser {

  constructor() {
    var _this = this;

    this.dipUrl = 'https://dipbt.bundestag.de';
    this.startUrl = '/dip21.web/bt';
    this.cookie = null;
    this.initialize = _asyncToGenerator(function* () {
      yield _this.request(_extends({}, _this.defReqOpt, {
        uri: _this.startUrl
      }));
    });

    this.request = opts => {
      const reqOptions = _extends({
        method: 'GET',
        jar: this.cookie
      }, opts);

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

    this.getBeratungsablaeufeSearchPage = _asyncToGenerator(function* () {
      const { body } = yield _this.request({
        uri: '/dip21.web/searchProcedures.do'
      });
      return body;
    });

    this.getSelectOptions = ({ $, selector }) => _.map($(selector).children(), ({ children, attribs: { value } }) => ({
      name: children[0].data,
      value
    }));

    this.getBeratungsablaeufeSearchOptions = (() => {
      var _ref3 = _asyncToGenerator(function* ({ body }) {
        const $ = cheerio.load(body);
        const wahlperioden = _this.getSelectOptions({
          $,
          selector: '#ProceduresSimpleSearchForm #wahlperiode'
        });
        let vorgangstyp = _this.getSelectOptions({
          $,
          selector: '#ProceduresSimpleSearchForm #includeVorgangstyp'
        });

        vorgangstyp = vorgangstyp.map(function (e) {
          return _extends({}, e, {
            number: e.name.split(' - ')[0]
          });
        });

        return {
          wahlperioden,
          vorgangstyp
        };
      });

      return function (_x) {
        return _ref3.apply(this, arguments);
      };
    })();

    this.getBeratungsablaeufeSearchFormData = (() => {
      var _ref4 = _asyncToGenerator(function* ({ body }) {
        const $ = cheerio.load(body);
        const formData = $('#ProceduresSimpleSearchForm').serializeArray().reduce(function (obj, { name, value }) {
          return _extends({}, obj, { [name]: value });
        }, {});
        const searchForm = $('#ProceduresSimpleSearchForm');
        return {
          formData,
          formMethod: searchForm.attr('method'),
          formAction: searchForm.attr('action')
        };
      });

      return function (_x2) {
        return _ref4.apply(this, arguments);
      };
    })();

    this.getSearchResultPage = (() => {
      var _ref5 = _asyncToGenerator(function* ({ formMethod, formAction, formData }) {
        return _this.request({
          method: formMethod,
          uri: formAction,
          form: formData
        });
      });

      return function (_x3) {
        return _ref5.apply(this, arguments);
      };
    })();

    this.getResultInfo = (() => {
      var _ref6 = _asyncToGenerator(function* ({ body }) {
        if (cheerio('#inhaltsbereich > div.inhalt > div.contentBox > fieldset.field.infoField > ul > li', body).length > 0) {
          return false;
        }
        const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
        const paginator = cheerio('#inhaltsbereich', body).html().match(reg);
        if (!paginator) {
          return 'isEntry';
        }
        return {
          pageCurrent: _.toInteger(paginator[1]),
          pageSum: _.toInteger(paginator[2]),
          entriesFrom: _.toInteger(paginator[3]),
          entriesTo: _.toInteger(paginator[4]),
          entriesSum: _.toInteger(paginator[5])
        };
      });

      return function (_x4) {
        return _ref6.apply(this, arguments);
      };
    })();

    this.getEntries = ({ body }) => {
      const $ = cheerio.load(body);
      const entries = $('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody tr');

      return _.map(entries, entry => {
        const { href } = $(entry).find($('a.linkIntern'))[0].attribs;
        const date = $(entry).find($('td:nth-child(4)')).text();
        return {
          id: href.match(/selId=(\d.*?)&/)[1],
          url: href,
          date,
          scraped: false
        };
      });
    };

    this.cookie = request.jar();
  }

}

exports.default = DipBrowser;

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