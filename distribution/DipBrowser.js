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
        timeout: 10000,
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

    this.getSelectOptions = ({ selectHtml }) => {
      const optionMatches = selectHtml.match(/<option.*?>.*?<\/option>/g).map(o => {
        const oMatches = o.match(/<option.*?value="(.*?)".*?>(.*?)<\/option>/);
        return {
          name: oMatches[2],
          value: oMatches[1]
        };
      });
      return optionMatches;
    };

    this.getBeratungsablaeufeSearchOptions = (() => {
      var _ref3 = _asyncToGenerator(function* ({ body }) {
        const periodMatches = body.match(/<select name="wahlperiode".*?>(.|\s)*?<\/select>/);
        const periods = _this.getSelectOptions({
          selectHtml: periodMatches[0]
        });

        const operationTypesMatches = body.match(/<select name="vorgangstyp".*?>(.|\s)*?<\/select>/);
        let operationTypes = _this.getSelectOptions({
          selectHtml: operationTypesMatches[0]
        });
        operationTypes = operationTypes.map(function (e) {
          return _extends({}, e, {
            number: e.name.split(' - ')[0]
          });
        });
        return {
          wahlperioden: periods,
          vorgangstyp: operationTypes
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