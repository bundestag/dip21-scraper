'use strict';

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
        const vorgangstyp = _this.getSelectOptions({
          $,
          selector: '#ProceduresSimpleSearchForm #includeVorgangstyp'
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
        return $('#ProceduresSimpleSearchForm').serializeArray().reduce(function (obj, { name, value }) {
          return _extends({}, obj, { [name]: value });
        }, {});
      });

      return function (_x2) {
        return _ref4.apply(this, arguments);
      };
    })();

    this.getFirstSearchResultPage = (() => {
      var _ref5 = _asyncToGenerator(function* ({ body, searchData }) {
        const $ = cheerio.load(body);
        const searchForm = $('#ProceduresSimpleSearchForm');
        return _this.request({
          method: searchForm.attr('method'),
          uri: searchForm.attr('action'),
          form: searchData
        });
      });

      return function (_x3) {
        return _ref5.apply(this, arguments);
      };
    })();

    this.getEntries = ({ body }) => {
      const $ = cheerio.load(body);
      const entries = $('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody tr').find($('a.linkIntern'));
      return _.map(entries, entry => entry.attribs.href);
    };

    this.cookie = request.jar();
  }

}

_asyncToGenerator(function* () {
  const browser = new DipBrowser();
  yield browser.initialize();

  const searchBody = yield browser.getBeratungsablaeufeSearchPage();

  /* Only get possible filter Data  */
  //   const searchOptions = await browser.getBeratungsablaeufeSearchOptions({ body: searchBody });
  //   console.log(searchOptions);

  const searchData = yield browser.getBeratungsablaeufeSearchFormData({ body: searchBody });

  /* suchoptionen einstellen */
  searchData.wahlperiode = '';
  searchData.method = 'Suchen';
  searchData.anzahlTreffer = 200;

  const { body: searchResult } = yield browser.getFirstSearchResultPage({
    body: searchBody,
    searchData
  });

  let entries = [];
  entries = [...entries, ...browser.getEntries({ body: searchResult })];
  console.log(entries);
})();