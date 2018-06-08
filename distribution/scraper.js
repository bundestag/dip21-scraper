'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _DipBrowser = require('./DipBrowser');

var _DipBrowser2 = _interopRequireDefault(_DipBrowser);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; } /* eslint-disable max-len */
/* eslint-disable no-throw-literal */

const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');
const _ = require('lodash');

const x2j = new X2JS();

process.setMaxListeners(Infinity);

class Scraper {
  constructor() {
    var _this = this;

    this.options = {
      selectPeriods: false,
      selectOperationTypes: false,
      logStartSearchProgress: () => {},
      logUpdateSearchProgress: () => {},
      logStopSearchProgress: () => {},
      logStartDataProgress: () => {},
      logUpdateDataProgress: () => {},
      logStopDataProgress: () => {},
      logFinished: () => {},
      logError: () => {},
      outScraperData: () => {},
      doScrape: () => true,
      browserStackSize: 1,
      resultsPerPage: 200
    };
    this.urls = {
      basisInfos: 'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail.do',
      processRunning: 'https://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_detail_vp.do?vorgangId=',
      start: 'https://dipbt.bundestag.de/dip21.web/bt',
      search: 'https://dipbt.bundestag.de/dip21.web/searchProcedures.do;jsessionid='
    };
    this.stack = [];
    this.availableFilters = {
      periods: [],
      operationTypes: []
    };
    this.filters = [];
    this.procedures = [];
    this.status = {
      search: {
        instances: {
          sum: 0,
          completed: 0
        },
        pages: {
          sum: 0,
          completed: 0
        }
      }
    };

    this.collectProcedures = (() => {
      var _ref = _asyncToGenerator(function* ({ periods, operationTypes }) {
        periods.forEach(function (period) {
          _this.filters = [..._this.filters, ...operationTypes.map(function (operationType) {
            return { period, operationType, scraped: false };
          })];
        });

        _this.status.search.instances.sum = _this.filters.length;

        yield Promise.all(_this.stack.map(function (browser, browserIndex) {
          return _this.getProceduresFromSearch({ browser, browserIndex });
        }));
        _this.procedures = _.uniqBy(_this.procedures, 'id');
      });

      return function (_x) {
        return _ref.apply(this, arguments);
      };
    })();

    this.getProceduresFromSearch = (() => {
      var _ref2 = _asyncToGenerator(function* ({ browser, browserIndex }) {
        while (_this.filters.findIndex(function ({ scraped }) {
          return !scraped;
        }) !== -1) {
          let hasError = false;
          const filterIndex = _this.filters.findIndex(function ({ scraped }) {
            return !scraped;
          });
          _this.filters[filterIndex].scraped = true;
          try {
            const searchBody = yield browser.browser.getBeratungsablaeufeSearchPage();
            const {
              formData,
              formMethod,
              formAction
            } = yield browser.browser.getBeratungsablaeufeSearchFormData({ body: searchBody });
            formData.wahlperiode = _this.filters[filterIndex].period;
            formData.vorgangstyp = _this.filters[filterIndex].operationType;
            formData.method = 'Suchen';
            formData.anzahlTreffer = _this.options.resultsPerPage;

            yield _this.startSearch({
              browser,
              formData,
              formMethod,
              formAction
            });
            _this.status.search.instances.completed += 1;
            _this.stack[browserIndex].errors = 0;
            _this.options.logUpdateSearchProgress(_extends({}, _this.status, { hasError }));
          } catch (error) {
            hasError = true;
            _this.options.logError({ error });
            _this.filters[filterIndex].scraped = false;
            _this.stack[browserIndex].errors += 1;
            _this.options.logUpdateSearchProgress(_extends({}, _this.status, { hasError }));

            yield _this.timeout();
            if (_this.stack[browserIndex].errors > 5) {
              throw {
                message: 'to many search errors',
                code: 1015
              };
            }
          }
        }
      });

      return function (_x2) {
        return _ref2.apply(this, arguments);
      };
    })();

    this.finalize = _asyncToGenerator(function* () {
      _this.stack = [];
      _this.availableFilters = {
        periods: [],
        operationTypes: []
      };
      _this.filters = [];
      _this.procedures = [];
      _this.status = {
        search: {
          instances: {
            sum: 0,
            completed: 0
          },
          pages: {
            sum: 0,
            completed: 0
          }
        }
      };
    });

    this.createBrowserStack = ({ size }) => [...Array(size)].map(_asyncToGenerator(function* () {
      return _this.createNewBrowser();
    }));

    this.createNewBrowser = (() => {
      var _ref5 = _asyncToGenerator(function* ({ browserObject } = {}) {
        if (browserObject) {
          delete browserObject.browser; // eslint-disable-line
        }
        const browser = new _DipBrowser2.default();
        yield browser.initialize();
        return {
          browser,
          used: false,
          scraped: 0,
          errors: 0
        };
      });

      return function () {
        return _ref5.apply(this, arguments);
      };
    })();

    this.configureFilter = (() => {
      var _ref6 = _asyncToGenerator(function* ({ periods, operationTypes }) {
        // Periods
        let selectedPeriods = [];
        if (_.isArray(_this.options.selectPeriods)) {
          selectedPeriods = _this.options.selectPeriods;
        } else if (_.isFunction(_this.options.selectPeriods)) {
          selectedPeriods = yield _this.options.selectPeriods({ periods });
        } else {
          throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof _this.options.selectPeriods}"`);
        }
        if (selectedPeriods.includes('Alle') || selectedPeriods.length === 0) {
          selectedPeriods = periods.filter(function ({ name }) {
            return name !== 'Alle';
          }).map(function ({ name }) {
            return name;
          });
        }

        // OperationTypes
        let selectedOperationTypes = [];
        if (_.isArray(_this.options.selectOperationTypes)) {
          selectedOperationTypes = _this.options.selectOperationTypes;
        } else if (_.isFunction(_this.options.selectOperationTypes)) {
          selectedOperationTypes = yield _this.options.selectOperationTypes({ operationTypes });
        } else {
          throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof _this.options.selectOperationTypes}"`);
        }
        if (selectedOperationTypes.includes('Alle') || selectedOperationTypes.length === 0) {
          selectedOperationTypes = operationTypes.filter(function ({ name }) {
            return name !== 'Alle';
          }).map(function ({ number }) {
            return number;
          });
        }

        return {
          periods: selectedPeriods.map(function (p) {
            return periods.find(function ({ name }) {
              return name === p;
            }).value;
          }),
          operationTypes: selectedOperationTypes.map(function (n) {
            return operationTypes.find(function ({ number }) {
              return number === n;
            }).value;
          })
        };
      });

      return function (_x3) {
        return _ref6.apply(this, arguments);
      };
    })();

    this.takeSearchableValues = (() => {
      var _ref7 = _asyncToGenerator(function* ({ browserObj }) {
        browserObj.used = true; // eslint-disable-line no-param-reassign
        const searchBody = yield browserObj.browser.getBeratungsablaeufeSearchPage();
        const searchOptions = yield browserObj.browser.getBeratungsablaeufeSearchOptions({
          body: searchBody
        });
        if (searchOptions.vorgangstyp.length === 0) {
          throw new Error();
        }
        browserObj.used = false; // eslint-disable-line no-param-reassign
        return {
          periods: searchOptions.wahlperioden,
          operationTypes: searchOptions.vorgangstyp
        };
      });

      return function (_x4) {
        return _ref7.apply(this, arguments);
      };
    })();

    this.startSearch = (() => {
      var _ref8 = _asyncToGenerator(function* ({
        browser, formData, formMethod, formAction
      }) {
        const { body: searchResultBody } = yield browser.browser.getSearchResultPage({
          formMethod,
          formAction,
          formData
        });

        const resultInfos = yield browser.browser.getResultInfo({ body: searchResultBody });

        if (!resultInfos) {
          return;
        } else if (resultInfos === 'isEntry') {
          const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
          const vorgangId = searchResultBody.match(procedureIdRegex)[1];
          _this.procedures.push({
            id: vorgangId.split('-')[1],
            url: `/dip21.web/searchProcedures/simple_search_list.do?selId=${vorgangId.split('-')[1]}&method=select&offset=0&anzahl=200&sort=3&direction=desc`,
            scraped: false
          });
          return;
        }

        _this.status.search.pages.sum += resultInfos.pageSum;
        let pagesCompleted = 0;
        let searchResultBodyToAnalyse = searchResultBody;
        for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i += 1) {
          try {
            if (i !== 1) {
              const {
                formMethod: newFormMethod,
                formAction: newFormAction,
                formData: newFormData
              } = yield browser.browser.getBeratungsablaeufeSearchFormData({ body: searchResultBodyToAnalyse });
              newFormData.method = '>'; // Next page can only be reached through this
              newFormData.offset = (i - 1) * _this.options.resultsPerPage;
              const { body: tmpBody } = yield browser.browser.getSearchResultPage({
                formMethod: newFormMethod,
                formAction: `http://dipbt.bundestag.de${newFormAction}`,
                formData: newFormData
              });
              searchResultBodyToAnalyse = tmpBody;
            }

            let pageLinks = browser.browser.getEntries({ body: searchResultBodyToAnalyse });
            pageLinks = pageLinks.filter(function (link) {
              return _this.options.doScrape({ data: link });
            });
            _this.procedures.push(...pageLinks);
            _this.status.search.pages.completed += 1;
            pagesCompleted += 1;
          } catch (error) {
            i = 1;
            _this.status.search.pages.sum -= resultInfos.pageSum;
            _this.status.search.pages.completed -= pagesCompleted;
            throw {
              error,
              function: 'startSearch',
              type: 'timeout',
              code: 1008
            };
          }
          _this.options.logUpdateSearchProgress(_this.status);
        }
      });

      return function (_x5) {
        return _ref8.apply(this, arguments);
      };
    })();

    this.getProcedureData = (() => {
      var _ref9 = _asyncToGenerator(function* ({ html }) {
        const xmlRegex = /<VORGANG>(.|[\r\n])*<\/VORGANG>/;
        const xmlString = html.match(xmlRegex)[0].replace('<- VORGANGSABLAUF ->', '');
        return x2j.xml2js(xmlString);
      });

      return function (_x6) {
        return _ref9.apply(this, arguments);
      };
    })();

    this.timeout = (() => {
      var _ref10 = _asyncToGenerator(function* ({ min, max } = { min: 1000, max: 5000 }) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve();
          }, _.random(min, max));
        });
      });

      return function () {
        return _ref10.apply(this, arguments);
      };
    })();
  }

  scrape(options) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      _this2.options = _extends({}, _this2.options, options);
      const { browserStackSize } = _this2.options;

      let stackCreated = false;
      while (!stackCreated) {
        try {
          _this2.stack = yield Promise.all(_this2.createBrowserStack({
            size: Math.max(browserStackSize, 1)
          }));
          stackCreated = true;
        } catch (error) {
          console.log('bundestag down (stack)');
          yield _this2.timeout();
        }
      }
      let hasData = false;
      while (!hasData) {
        try {
          _this2.availableFilters = yield _this2.takeSearchableValues({ browserObj: _this2.stack[0] });
          hasData = true;
        } catch (error) {
          console.log('bundestag down (search)');
          yield _this2.timeout({ min: 10000, max: 10000 });
          yield _this2.createNewBrowser({ browserObject: _this2.stack[0] }).then((() => {
            var _ref11 = _asyncToGenerator(function* (newBrowser) {
              _this2.stack[0] = newBrowser;
            });

            return function (_x7) {
              return _ref11.apply(this, arguments);
            };
          })()).catch((() => {
            var _ref12 = _asyncToGenerator(function* (error2) {
              _this2.options.logError({ error2 });
            });

            return function (_x8) {
              return _ref12.apply(this, arguments);
            };
          })());
        }
      }
      const filtersSelected = yield _this2.configureFilter(_this2.availableFilters);

      _this2.options.logStartSearchProgress(_this2.status);
      yield _this2.collectProcedures(filtersSelected);

      // Data
      _this2.completedLinks = 0;
      yield _this2.options.logStartDataProgress({
        sum: _this2.procedures.length,
        retries: _this2.retries
      });
      _this2.options.logStopSearchProgress();

      yield Promise.all(_this2.stack.map((() => {
        var _ref13 = _asyncToGenerator(function* (browser, browserIndex) {
          yield _this2.startAnalyse(browserIndex);
        });

        return function (_x9, _x10) {
          return _ref13.apply(this, arguments);
        };
      })())).then(_asyncToGenerator(function* () {
        _this2.options.logUpdateDataProgress({
          value: _this2.completedLinks,
          retries: _this2.retries,
          browsers: _this2.stack
        });
        // Finalize
        _this2.options.logStopDataProgress();
        yield _this2.finalize();
        _this2.options.logFinished();
      }));
    })();
  }

  startAnalyse(browserIndex) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      while (_this3.procedures.findIndex(function ({ scraped }) {
        return !scraped;
      }) !== -1) {
        let hasError = false;
        if (!_this3.stack[browserIndex].browser) {
          hasError = true;
          _this3.options.logUpdateDataProgress({
            value: _this3.completedLinks,
            retries: _this3.retries,
            browsers: _this3.stack,
            hasError
          });
          yield _this3.timeout();
          yield _this3.createNewBrowser({ browserObject: _this3.stack[browserIndex] }).then((() => {
            var _ref15 = _asyncToGenerator(function* (newBrowser) {
              _this3.stack[browserIndex] = newBrowser;
            });

            return function (_x11) {
              return _ref15.apply(this, arguments);
            };
          })()).catch((() => {
            var _ref16 = _asyncToGenerator(function* (error) {
              _this3.options.logError({ error });
            });

            return function (_x12) {
              return _ref16.apply(this, arguments);
            };
          })());
        } else {
          const linkIndex = _this3.procedures.findIndex(function ({ scraped }) {
            return !scraped;
          });

          _this3.stack[browserIndex].used = true;
          _this3.procedures[linkIndex].scraped = true;
          yield _this3.saveJson({
            link: _this3.procedures[linkIndex].url,
            dipBrowser: _this3.stack[browserIndex].browser
          }).then(_asyncToGenerator(function* () {
            _this3.completedLinks += 1;
            _this3.stack[browserIndex].used = false;
            _this3.stack[browserIndex].scraped += 1;
            _this3.stack[browserIndex].errors = 0;
            _this3.options.logUpdateDataProgress({
              value: _this3.completedLinks,
              retries: _this3.retries,
              browsers: _this3.stack,
              hasError
            });
          })).catch((() => {
            var _ref18 = _asyncToGenerator(function* (error) {
              _this3.options.logError({ error });
              _this3.procedures[linkIndex].scraped = false;
              _this3.stack[browserIndex].used = false;
              _this3.stack[browserIndex].errors += 1;
              hasError = true;
              _this3.options.logUpdateDataProgress({
                value: _this3.completedLinks,
                retries: _this3.retries,
                browsers: _this3.stack,
                hasError
              });

              yield _this3.timeout();

              if (_this3.stack[browserIndex].errors >= 5) {
                yield _this3.createNewBrowser({ browserObject: _this3.stack[browserIndex] }).then((() => {
                  var _ref19 = _asyncToGenerator(function* (newBrowser) {
                    _this3.stack[browserIndex] = newBrowser;
                  });

                  return function (_x14) {
                    return _ref19.apply(this, arguments);
                  };
                })()).catch((() => {
                  var _ref20 = _asyncToGenerator(function* (error2) {
                    _this3.options.logError({ error2 });
                  });

                  return function (_x15) {
                    return _ref20.apply(this, arguments);
                  };
                })());
              }
            });

            return function (_x13) {
              return _ref18.apply(this, arguments);
            };
          })());
        }
      }
    })();
  }

  selectPeriod({ browser, periodName }) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      const period = _this4.availableFilters.periods.find(function (p) {
        return p.name === periodName;
      });
      yield Promise.all([browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }), browser.page.select('select#wahlperiode', period.value)]).catch(function (error) {
        throw {
          error,
          function: 'selectPeriod',
          code: 1005
        };
      });
    })();
  }

  selectOperationTypes({ browser, operationTypeNumber }) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      const operationType = _this5.availableFilters.operationTypes.find(function (o) {
        return o.number === operationTypeNumber;
      });
      if (!operationType) {
        throw new Error(`OperationType "${operationTypeNumber}" not found`);
      }
      yield browser.page.select('select#includeVorgangstyp', `${operationType.value}`);
    })();
  }

  saveJson({ link, dipBrowser }) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
      const { body: entryBody } = yield dipBrowser.request({
        uri: link
      });

      let procedureId;
      try {
        procedureId = entryBody.match(procedureIdRegex)[1]; // eslint-disable-line
      } catch (error) {
        throw {
          error,
          code: 1012
        };
      }
      const urlObj = Url.parse(link);
      const queryObj = Querystring.parse(urlObj.query);
      const vorgangId = queryObj.selId;
      if (procedureId.split('-')[1] !== vorgangId) {
        const error = new Error(`Procedure ID missmatch URL: "${vorgangId}" to HTML: "${procedureId.split('-')[1]}"`);
        throw {
          error,
          code: 1013
        };
      }

      const dataProcedure = yield _this6.getProcedureData({ html: entryBody });

      const { body: entryRunningBody } = yield dipBrowser.request({
        uri: `${_this6.urls.processRunning}${vorgangId}`
      });

      const dataProcedureRunning = yield Scraper.getProcedureRunningData({
        html: entryRunningBody
      });

      const procedureData = _extends({
        vorgangId
      }, dataProcedure, dataProcedureRunning);
      _this6.options.outScraperData({ procedureId, procedureData });
    })();
  }

  static getProcedureRunningData({ html }) {
    return _asyncToGenerator(function* () {
      const xmlRegex = /<VORGANGSABLAUF>(.|[\r\n])*<\/VORGANGSABLAUF>/;
      const xmlString = html.match(xmlRegex)[0];
      return x2j.xml2js(xmlString);
    })();
  }

}

module.exports = Scraper;