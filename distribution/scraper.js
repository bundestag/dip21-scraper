'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/* eslint-disable max-len */
/* eslint-disable no-throw-literal */

const puppeteer = require('puppeteer');
const X2JS = require('x2js');
const Url = require('url');
const Querystring = require('querystring');
const _ = require('lodash');
const chalk = require('chalk');
const Page = require('puppeteer/lib/Page');

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
      timeoutStart: 3001,
      timeoutSearch: () => 5001,
      maxRetries: () => 20,
      defaultTimeout: 15000
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
        const filterIndex = _this.filters.findIndex(function ({ scraped }) {
          return !scraped;
        });
        if (filterIndex !== -1) {
          _this.filters[filterIndex].scraped = true;
          try {
            yield _this.goToSearch({ browser });
            yield _this.selectPeriod({ browser, periodName: _this.filters[filterIndex].period });
            yield _this.selectOperationTypes({
              browser,
              operationTypeNumber: _this.filters[filterIndex].operationType
            });
            yield _this.startSearch({ browser }).then(function () {
              _this.status.search.instances.completed += 1;
            }).catch((() => {
              var _ref3 = _asyncToGenerator(function* (error) {
                _this.filters[filterIndex].scraped = false;
                error.code = 1002;
                throw error;
              });

              return function (_x3) {
                return _ref3.apply(this, arguments);
              };
            })());
          } catch (error) {
            _this.options.logError({ error });
            _this.filters[filterIndex].scraped = false;
            _this.stack[browserIndex].errors += 1;
            if (_this.stack[browserIndex].errors >= 5) {
              yield _this.createNewBrowser({ browserObject: _this.stack[browserIndex] }).then(function (newBrowser) {
                _this.stack[browserIndex] = newBrowser;
              }).catch(function (error2) {
                _this.options.logError({ error2, function: 'getProceduresFromSearch' });
              });
            }
          } finally {
            _this.options.logUpdateSearchProgress(_this.status);
            yield _this.getProceduresFromSearch({ browser, browserIndex });
          }
        }
        _this.options.logUpdateSearchProgress(_this.status);
      });

      return function (_x2) {
        return _ref2.apply(this, arguments);
      };
    })();

    this.finalize = _asyncToGenerator(function* () {
      yield Promise.all(_this.stack.map((() => {
        var _ref5 = _asyncToGenerator(function* (b) {
          yield _this.closePage(b);
        });

        return function (_x4) {
          return _ref5.apply(this, arguments);
        };
      })()));
      yield _this.browser.close();

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

    this.newPageWithNewContext = (() => {
      var _ref7 = _asyncToGenerator(function* ({ browser = _this.browser }) {
        const { browserContextId } = yield browser._connection.send('Target.createBrowserContext');
        const { targetId } = yield browser._connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
        const target = yield browser._targets.get(targetId);
        const client = yield browser._connection.createSession(targetId);
        const page = yield Page.create(client, target, browser._ignoreHTTPSErrors, browser._screenshotTaskQueue);
        page.setDefaultNavigationTimeout(_this.options.defaultTimeout);
        page.browserContextId = browserContextId;
        return page;
      });

      return function (_x5) {
        return _ref7.apply(this, arguments);
      };
    })();

    this.closePage = (() => {
      var _ref8 = _asyncToGenerator(function* ({ browser, page }) {
        if (page.browserContextId !== undefined) {
          yield browser._connection.send('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
        }
        yield page.close();
      });

      return function (_x6) {
        return _ref8.apply(this, arguments);
      };
    })();

    this.createNewBrowser = (() => {
      var _ref9 = _asyncToGenerator(function* ({ browserObject = {} } = {}) {
        const { timeoutStart } = _this.options;
        if (browserObject.page) {
          yield _this.closePage(browserObject);
        }
        try {
          const page = yield _this.newPageWithNewContext(browserObject);
          yield page.setRequestInterception(true);
          page.on('request', function (request) {
            switch (request.resourceType()) {
              case 'image':
              case 'script':
              case 'stylesheet':
                request.abort();
                break;

              default:
                request.continue();
                break;
            }
          });
          yield page.goto(_this.urls.start, {
            timeout: timeoutStart
          });
          return {
            browser: _this.browser,
            page,
            used: false,
            scraped: 0,
            errors: 0
          };
        } catch (error) {
          _this.options.logError({
            error,
            function: 'createNewBrowser'
          });
          return new Promise(function (resolve) {
            setTimeout(_asyncToGenerator(function* () {
              resolve((yield _this.createNewBrowser({ browserObject })));
            }), 10000);
          });
        }
      });

      return function () {
        return _ref9.apply(this, arguments);
      };
    })();

    this.configureFilter = (() => {
      var _ref11 = _asyncToGenerator(function* ({ periods, operationTypes }) {
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
        if (selectedOperationTypes.includes('all') || selectedOperationTypes.length === 0) {
          selectedOperationTypes = operationTypes.filter(function ({ name }) {
            return name !== 'Alle';
          }).map(function ({ number }) {
            return number;
          });
        }

        return { periods: selectedPeriods, operationTypes: selectedOperationTypes };
      });

      return function (_x7) {
        return _ref11.apply(this, arguments);
      };
    })();

    this.takeOperationTypes = (() => {
      var _ref12 = _asyncToGenerator(function* ({ browser }) {
        const selectField = yield browser.page.evaluate(function (sel) {
          return document.querySelector(sel).outerHTML;
        }, '#includeVorgangstyp');
        const values = x2j.xml2js(selectField).select.option.map(function (o) {
          return {
            value: o._value,
            name: o.__text,
            number: o.__text.match(/\d{3}/) ? o.__text.match(/\d{3}/)[0] : 'all'
          };
        });
        return values;
      });

      return function (_x8) {
        return _ref12.apply(this, arguments);
      };
    })();

    this.getFreeBrowser = () => this.stack.find(({ used }) => !used);

    this.takeSearchableValues = _asyncToGenerator(function* () {
      const browser = _this.getFreeBrowser();
      browser.used = true;
      yield _this.goToSearch({ browser });
      const periods = yield _this.takePeriods({ browser });
      const operationTypes = yield _this.takeOperationTypes({ browser });
      browser.used = false;
      return {
        periods,
        operationTypes
      };
    });

    this.isSingleResult = (() => {
      var _ref14 = _asyncToGenerator(function* ({ browser }) {
        try {
          const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
          const content = yield browser.page.evaluate(function (sel) {
            return document.querySelector(sel).innerHTML;
          }, '#inhaltsbereich');

          const procedureId = content.match(procedureIdRegex)[1];
          if (procedureId) {
            _this.procedures.push({
              id: procedureId.split('-')[1],
              url: `http://dipbt.bundestag.de/dip21.web/searchProcedures/simple_search_list.do?selId=${procedureId.split('-')[1]}&method=select`,
              scraped: false
            });
          }
          return true;
        } catch (error) {
          return false;
        }
      });

      return function (_x9) {
        return _ref14.apply(this, arguments);
      };
    })();

    this.startSearch = (() => {
      var _ref15 = _asyncToGenerator(function* ({ browser }) {
        // await this.clickWait({ browser, selector: 'input#btnSuche' });
        let hasEntries = true;
        yield Promise.all([browser.page.click('input#btnSuche'), browser.page.waitForSelector('#tabReiter0 > a', { timeout: 3000 }), browser.page.waitForSelector('#footer')]).catch((() => {
          var _ref16 = _asyncToGenerator(function* (error) {
            if ((yield browser.page.$eval('#inhaltsbereich > div.inhalt > div.contentBox > fieldset.field.infoField > ul > li', function (e) {
              return e.innerHTML.trim();
            })) === 'Es konnte kein Datensatz gefunden werden.') {
              hasEntries = false;
            } else {
              error.code = 1007;
              throw error;
            }
          });

          return function (_x11) {
            return _ref16.apply(this, arguments);
          };
        })());
        if (!hasEntries || (yield _this.isSingleResult({ browser }))) {
          return;
        }
        const resultInfos = yield _this.getResultInfos({ browser });
        _this.status.search.pages.sum += resultInfos.pageSum;
        let pagesCompleted = 0;
        for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i += 1) {
          try {
            const pageLinks = yield _this.getEntriesFromPage({ browser });
            _this.procedures.push(...pageLinks);
            const curResultInfos = yield _this.getResultInfos({ browser });
            _this.status.search.pages.completed += 1;
            pagesCompleted += 1;
            if (curResultInfos.pageCurrent !== curResultInfos.pageSum) {
              yield _this.clickWait({
                browser,
                selector: '#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.blaetterNavigationLeiste > div.navigationListeNachRechts > input'
              });
            }
          } catch (error) {
            _this.status.search.pages.sum -= resultInfos.pageSum;
            _this.status.search.pages.completed -= pagesCompleted;
            throw {
              error,
              function: 'startSearch',
              type: 'timeout',
              code: 1008
            };
          } finally {
            _this.options.logUpdateSearchProgress(_this.status);
          }
        }
      });

      return function (_x10) {
        return _ref15.apply(this, arguments);
      };
    })();
  }

  scrape(options) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      _this2.options = _extends({}, _this2.options, options);
      const { browserStackSize } = _this2.options;

      _this2.browser = yield puppeteer.launch({ timeout: _this2.options.defaultTimeout });

      // this.retries = -this.options.browserStackSize();
      _this2.stack = yield Promise.all(_this2.createBrowserStack({
        size: browserStackSize
      }));

      _this2.availableFilters = yield _this2.takeSearchableValues().catch(function (error) {
        _this2.finalize();
        throw {
          error,
          message: 'Bundestag ist DOWN!!!',
          type: chalk.red('fatal'),
          code: 1001
        };
      });
      const filtersSelected = yield _this2.configureFilter(_this2.availableFilters);
      _this2.options.logStartSearchProgress(_this2.status);
      yield _this2.collectProcedures(filtersSelected);

      // Data
      _this2.completedLinks = 0;
      yield _this2.options.logStartDataProgress({
        sum: _this2.procedures.length,
        retries: _this2.retries,
        maxRetries: _this2.options.maxRetries
      });
      _this2.options.logStopSearchProgress();

      yield Promise.all(_this2.stack.map((() => {
        var _ref17 = _asyncToGenerator(function* (browser, browserIndex) {
          yield _this2.startAnalyse(browserIndex);
        });

        return function (_x12, _x13) {
          return _ref17.apply(this, arguments);
        };
      })())).then(_asyncToGenerator(function* () {
        _this2.options.logUpdateDataProgress({
          value: _this2.completedLinks,
          retries: _this2.retries,
          maxRetries: _this2.options.maxRetries,
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
      const linkIndex = _this3.procedures.findIndex(function ({ scraped }) {
        return !scraped;
      });
      if (linkIndex !== -1) {
        _this3.stack[browserIndex].used = true;
        _this3.procedures[linkIndex].scraped = true;
        yield _this3.saveJson({
          link: _this3.procedures[linkIndex].url,
          page: _this3.stack[browserIndex].page
        }).then(_asyncToGenerator(function* () {
          _this3.completedLinks += 1;
          _this3.stack[browserIndex].used = false;
          _this3.stack[browserIndex].scraped += 1;
        })).catch((() => {
          var _ref20 = _asyncToGenerator(function* (error) {
            _this3.options.logError({ error });
            _this3.procedures[linkIndex].scraped = false;
            _this3.stack[browserIndex].used = false;
            _this3.stack[browserIndex].errors += 1;

            if (_this3.stack[browserIndex].errors >= 5) {
              yield _this3.createNewBrowser({ browserObject: _this3.stack[browserIndex] }).then((() => {
                var _ref21 = _asyncToGenerator(function* (newBrowser) {
                  _this3.stack[browserIndex] = newBrowser;
                });

                return function (_x15) {
                  return _ref21.apply(this, arguments);
                };
              })()).catch(function () {});
            }
          });

          return function (_x14) {
            return _ref20.apply(this, arguments);
          };
        })()).then(_asyncToGenerator(function* () {
          _this3.options.logUpdateDataProgress({
            value: _this3.completedLinks,
            retries: _this3.retries,
            maxRetries: _this3.options.maxRetries,
            browsers: _this3.stack
          });
          yield _this3.startAnalyse(browserIndex);
        }));
      }
    })();
  }

  goToSearch({ browser }) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      const cookies = yield browser.page.cookies().catch(function (error) {
        throw {
          error,
          function: 'goToSearch',
          code: 1004
        };
      });
      const jssessionCookie = cookies.filter(function (c) {
        return c.name === 'JSESSIONID';
      });
      yield browser.page.goto(_this4.urls.search + jssessionCookie[0].value, {
        timeout: _this4.options.timeoutSearch()
      });
    })();
  }

  takePeriods({ browser }) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      yield browser.page.waitForSelector('input#btnSuche', { timeout: _this5.options.timeoutSearch() });
      const selectField = yield browser.page.evaluate(function (sel) {
        return document.querySelector(sel).outerHTML;
      }, '#wahlperiode');
      const values = x2j.xml2js(selectField).select.option.map(function (o) {
        return { value: o._value, name: o.__text };
      });
      return values;
    })();
  }

  selectPeriod({ browser, periodName }) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      const period = _this6.availableFilters.periods.find(function (p) {
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
    var _this7 = this;

    return _asyncToGenerator(function* () {
      const operationType = _this7.availableFilters.operationTypes.find(function (o) {
        return o.number === operationTypeNumber;
      });
      if (!operationType) {
        throw new Error(`OperationType "${operationTypeNumber}" not found`);
      }
      yield browser.page.select('select#includeVorgangstyp', `${operationType.value}`);
    })();
  }

  getResultInfos({ browser }) {
    var _this8 = this;

    return _asyncToGenerator(function* () {
      const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
      yield browser.page.waitForSelector('#footer', { timeout: _this8.options.timeoutSearch() }).catch(function (error) {
        throw {
          error,
          code: 1006,
          function: 'getResultInfos'
        };
      });
      const resultsNumberString = yield browser.page.evaluate(function (sel) {
        return document.querySelector(sel).outerHTML;
      }, '#inhaltsbereich');
      const paginator = resultsNumberString.match(reg);

      return {
        pageCurrent: _.toInteger(paginator[1]),
        pageSum: _.toInteger(paginator[2]),
        entriesFrom: _.toInteger(paginator[3]),
        entriesTo: _.toInteger(paginator[4]),
        entriesSum: _.toInteger(paginator[5])
      };
    })();
  }

  getEntriesFromPage({ browser }) {
    var _this9 = this;

    return _asyncToGenerator(function* () {
      const links = yield browser.page.$$eval('#inhaltsbereich > div.inhalt > div.contentBox > fieldset:nth-child(2) > fieldset:nth-child(1) > div.tabelleGross > table > tbody > tr', function (els) {
        return els.map(function (el) {
          const urlSelector = el.querySelector('a.linkIntern');
          const dateSelector = el.querySelector('td:nth-child(4)');
          if (urlSelector && dateSelector) {
            return {
              id: urlSelector.href.match(/selId=(\d.*?)&/)[1],
              url: urlSelector.href,
              date: dateSelector.innerHTML,
              scraped: false
            };
          }
          const error = new Error('Could not get Entries from Page');
          throw {
            error,
            code: 1009
          };
        });
      });
      return links.filter(function (link) {
        return _this9.options.doScrape({ data: link });
      });
    })();
  }

  saveJson({ link, page }) {
    var _this10 = this;

    return _asyncToGenerator(function* () {
      const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
      yield page.goto(link).catch(function (error) {
        throw {
          error,
          type: 'timeout',
          url: link,
          function: 'saveJson',
          code: 1010
        };
      });
      let content;
      try {
        content = yield page.evaluate(function (sel) {
          return document.querySelector(sel).innerHTML;
        }, '#inhaltsbereich');
      } catch (error) {
        throw {
          error,
          type: 'not found',
          url: link,
          function: 'saveJson',
          code: 1011
        };
      }

      let procedureId;
      try {
        procedureId = content.match(procedureIdRegex)[1]; // eslint-disable-line
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

      const dataProcedure = yield Scraper.getProcedureData({ page });
      yield page.goto(`${_this10.urls.processRunning}${vorgangId}`).catch(function (error) {
        throw {
          error,
          type: 'timeout',
          url: link,
          function: 'saveJson',
          code: 1014
        };
      });
      const dataProcedureRunning = yield Scraper.getProcedureRunningData({ page });

      const procedureData = _extends({
        vorgangId
      }, dataProcedure, dataProcedureRunning);
      _this10.options.outScraperData({ procedureId, procedureData });
    })();
  }

  static getProcedureData({ page }) {
    return _asyncToGenerator(function* () {
      const xmlRegex = /<VORGANG>(.|\n)*?<\/VORGANG>/;
      const html = yield page.content();
      const xmlString = html.match(xmlRegex)[0].replace('<- VORGANGSABLAUF ->', '');
      return x2j.xml2js(xmlString);
    })();
  }

  static getProcedureRunningData({ page }) {
    return _asyncToGenerator(function* () {
      const xmlRegex = /<VORGANGSABLAUF>(.|\n)*?<\/VORGANGSABLAUF>/;
      const html = yield page.content();
      try {
        const xmlString = html.match(xmlRegex)[0];
        return x2j.xml2js(xmlString);
      } catch (error) {
        throw {
          type: 'warning',
          url: yield page.url(),
          error,
          function: 'getProcedureRunningData',
          code: 1015
        };
      }
    })();
  }

  clickWait({ browser, selector }) {
    return Promise.all([browser.page.click(selector), browser.page.waitForNavigation({
      waitUntil: ['domcontentloaded']
    }), browser.page.waitForSelector('#footer', { timeout: this.options.timeoutSearch() })]);
  }
}

module.exports = Scraper;