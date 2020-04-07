/* eslint-disable max-len */
/* eslint-disable no-throw-literal */

import DipBrowser from './DipBrowser';

import X2JS from 'x2js';
import Url from 'url';
import Querystring from 'querystring';
import _ from 'lodash';
import { AllHtmlEntities as Entities } from 'html-entities';
import {
  IUrls,
  IOptions,
  IStatus,
  IStack,
  IFilters,
  IProcedures,
  IAvailableFilters,
  IFormData,
} from './types';

const x2j = new X2JS();

process.setMaxListeners(Infinity);

export default class Scraper {
  baseUrl: string;
  completedLinks: number = 0;
  retries: number = 0;
  urls: IUrls;
  constructor(props: { baseUrl: string }) {
    if (!props.baseUrl) {
      throw new Error('missing base url');
    }
    this.baseUrl = props.baseUrl;
    this.urls = {
      processRunning: `https://${this.baseUrl}/dip21.web/searchProcedures/simple_search_detail_vp.do?vorgangId=`,
      search: `https://${this.baseUrl}/dip21.web/searchProcedures.do;jsessionid=`,
      dipUrl: `https://${this.baseUrl}`,
      startUrl: `https://${this.baseUrl}/dip21.web/bt`,
    };
  }

  options: IOptions = {
    selectPeriods: () => [],
    selectOperationTypes: false,
    logStartSearchProgress: () => {},
    logUpdateSearchProgress: () => {},
    logStopSearchProgress: () => {},
    logStartDataProgress: ({ sum, retries }) => {},
    logUpdateDataProgress: () => {},
    logStopDataProgress: () => {},
    logFinished: () => {},
    logError: () => {},
    outScraperData: () => {},
    doScrape: () => true,
    browserStackSize: 1,
    resultsPerPage: 200,
    scrapeType: 'live',
    liveScrapeStates: [],
  };

  stack: IStack[] = [];
  availableFilters: IAvailableFilters = {
    periods: [],
    operationTypes: [],
  };
  filters: IFilters[] = [];
  procedures: IProcedures[] = [];
  status: IStatus = {
    search: {
      instances: {
        sum: 0,
        completed: 0,
      },
      pages: {
        sum: 0,
        completed: 0,
      },
    },
  };

  async scrape(options: IOptions) {
    this.options = { ...this.options, ...options };

    const { browserStackSize } = this.options;

    let stackCreated = false;
    while (!stackCreated) {
      try {
        this.stack = await Promise.all(this.createBrowserStack(Math.max(browserStackSize, 1)));
        stackCreated = true;
      } catch (error) {
        console.log(error);
        console.log('bundestag down (stack)');
        await this.timeout();
      }
    }

    let hasData = false;
    while (!hasData) {
      try {
        this.availableFilters = await this.takeSearchableValues(this.stack[0]);
        hasData = true;
      } catch (error) {
        console.log('bundestag down (search)', error);
        await this.timeout({ min: 10000, max: 10000 });
        await this.createNewBrowser(this.stack[0])
          .then(async (newBrowser) => {
            this.stack[0] = newBrowser;
          })
          .catch(async (error2) => {
            this.options.logError({ error: error2 });
          });
      }
    }
    const filtersSelected = await this.configureFilter(this.availableFilters);

    if (this.options.logStartSearchProgress) {
      this.options.logStartSearchProgress(this.status);
    }
    await this.collectProcedures(filtersSelected);

    // Data
    this.completedLinks = 0;
    await this.options.logStartDataProgress({
      sum: this.procedures.length,
      retries: this.retries,
    });
    if (this.options.logStopSearchProgress) {
      this.options.logStopSearchProgress();
    }

    await Promise.all(this.stack.map(async (browser, browserIndex) => {
      await this.startAnalyse(browserIndex);
    })).then(async () => {
      this.options.logUpdateDataProgress({
        value: this.completedLinks,
        retries: this.retries,
        browsers: this.stack,
      });
      // Finalize
      this.options.logStopDataProgress();
      await this.finalize();
      this.options.logFinished();
    });
  }

  encodedStr = (value: string) => {
    const entities = new Entities();

    return entities.encode(value);
  };

  collectProcedures = async ({
    periods,
    operationTypes,
  }: {
  periods: string[];
  operationTypes: string[];
  }) => {
    if (this.options.scrapeType !== 'html') {
      periods.forEach((period) => {
        this.filters = [
          ...this.filters,
          ...operationTypes.map(operationType => ({ period, operationType, scraped: false })),
        ];
      });
    } else {
      periods.forEach((period) => {
        this.filters = [...this.filters, { period, operationTypes, scraped: false }];
      });
    }

    this.status.search.instances.sum = this.filters.length;

    await Promise.all(this.stack.map((browser, browserIndex) =>
      this.getProceduresFromSearch({ browser, browserIndex })));
    this.procedures = _.uniqBy(this.procedures, 'id');
  };

  getProceduresFromSearch = async ({
    browser,
    browserIndex,
  }: {
  browser: IStack;
  browserIndex: number;
  }) => {
    while (this.filters.findIndex(({ scraped }) => !scraped) !== -1) {
      let hasError = false;
      const filterIndex = this.filters.findIndex(({ scraped }) => !scraped);
      this.filters[filterIndex].scraped = true;
      try {
        if (this.options.scrapeType !== 'html') {
          const searchBody = await browser.browser.getBeratungsablaeufeSearchPage();
          const {
            formData,
            formMethod,
            formAction,
          } = await browser.browser.getBeratungsablaeufeSearchFormData(searchBody);
          formData.wahlperiode = this.filters[filterIndex].period;
          formData.vorgangstyp = this.filters[filterIndex].operationType;
          formData.method = 'Suchen';
          formData.anzahlTreffer = this.options.resultsPerPage;

          await this.startSearch({
            browser,
            formData,
            formMethod,
            formAction,
          });
        } else {
          const { data: htmlPeriodBody } = await browser.browser.request(`/extrakt/ba/WP${this.filters[filterIndex].period}/index.html`);
          const opTypes = this.filters[filterIndex].operationTypes;
          if (opTypes) {
            const linkExp = new RegExp(
              `<td>(?:${opTypes.map(o => this.encodedStr(o)).join('|')})</td>.*?href="(.*?)"`,
              'gm',
            );
            const procedureDataMatch = htmlPeriodBody.match(linkExp);
            if (procedureDataMatch) {
              const procedureData = procedureDataMatch.reduce<IProcedures[]>((pre, s) => {
                const linkParts = s.match(/href="(.*?)"/);
                if (linkParts) {
                  const linkPart = linkParts[1];
                  const id = linkPart.match(/\/(\d+).html/);
                  if (id) {
                    return [
                      ...pre,
                      {
                        id: id[1],
                        url: `https://dipbt.bundestag.de/extrakt/ba/WP${this.filters[filterIndex].period}/${linkPart}`,
                        scraped: false,
                      },
                    ];
                  }
                }
                return pre;
              }, []);
              this.procedures = [...this.procedures, ...procedureData];
            }
          }
        }
        this.status.search.instances.completed += 1;
        this.stack[browserIndex].errors = 0;
        this.options.logUpdateSearchProgress({ ...this.status, hasError });
      } catch (error) {
        hasError = true;
        this.options.logError({ error });
        this.filters[filterIndex].scraped = false;
        this.stack[browserIndex].errors += 1;
        this.options.logUpdateSearchProgress({ ...this.status, hasError });

        await this.timeout();
        if (this.stack[browserIndex].errors > 5) {
          throw {
            message: 'to many search errors',
            code: 1015,
          };
        }
      }
    }
  };

  async startAnalyse(browserIndex: number) {
    while (this.procedures.findIndex(({ scraped }) => !scraped) !== -1) {
      let hasError = false;
      if (!this.stack[browserIndex].browser) {
        hasError = true;
        this.options.logUpdateDataProgress({
          value: this.completedLinks,
          retries: this.retries,
          browsers: this.stack,
          hasError,
        });
        await this.timeout();
        await this.createNewBrowser(this.stack[browserIndex])
          .then(async (newBrowser) => {
            this.stack[browserIndex] = newBrowser;
          })
          .catch(async (error) => {
            this.options.logError({ error });
          });
      } else {
        const linkIndex = this.procedures.findIndex(({ scraped }) => !scraped);

        this.stack[browserIndex].used = true;
        this.procedures[linkIndex].scraped = true;
        await this.saveJson({
          link: this.procedures[linkIndex].url,
          id: this.procedures[linkIndex].id,
          dipBrowser: this.stack[browserIndex].browser,
          scrapeVersion: this.options.scrapeType,
        })
          .then(async () => {
            this.completedLinks += 1;
            this.stack[browserIndex].used = false;
            this.stack[browserIndex].scraped += 1;
            this.stack[browserIndex].errors = 0;
            this.options.logUpdateDataProgress({
              value: this.completedLinks,
              retries: this.retries,
              browsers: this.stack,
              hasError,
            });
          })
          .catch(async (error) => {
            this.options.logError({ error });
            this.procedures[linkIndex].scraped = false;
            this.stack[browserIndex].used = false;
            this.stack[browserIndex].errors += 1;
            hasError = true;
            this.options.logUpdateDataProgress({
              value: this.completedLinks,
              retries: this.retries,
              browsers: this.stack,
              hasError,
            });

            await this.timeout();

            if (this.stack[browserIndex].errors >= 5) {
              await this.createNewBrowser(this.stack[browserIndex])
                .then(async (newBrowser) => {
                  this.stack[browserIndex] = newBrowser;
                })
                .catch(async (error2) => {
                  this.options.logError({ error: error2 });
                });
            }
          });
      }
    }
  }

  finalize = async () => {
    this.stack = [];
    this.availableFilters = {
      periods: [],
      operationTypes: [],
    };
    this.filters = [];
    this.procedures = [];
    this.status = {
      search: {
        instances: {
          sum: 0,
          completed: 0,
        },
        pages: {
          sum: 0,
          completed: 0,
        },
      },
    };
  };

  createBrowserStack = (size: number) => [...Array(size)].map(async () => this.createNewBrowser());

  createNewBrowser = async (browserObject?: IStack) => {
    if (browserObject) {
      delete browserObject.browser; // eslint-disable-line
    }
    const browser = new DipBrowser(this.urls);
    await browser.initialize();
    return {
      browser,
      used: false,
      scraped: 0,
      errors: 0,
    };
  };

  configureFilter = async ({ periods, operationTypes }: IAvailableFilters) => {
    // Periods
    let selectedPeriods: string[] = [];

    if (_.isArray(this.options.selectPeriods)) {
      selectedPeriods = this.options.selectPeriods;
    } else if (this.options.selectPeriods && typeof this.options.selectPeriods === 'function') {
      selectedPeriods = await this.options.selectPeriods(periods);
    } else {
      throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof this
        .options.selectPeriods}"`);
    }
    if (selectedPeriods.includes('Alle') || selectedPeriods.length === 0) {
      selectedPeriods = periods.filter(({ name }) => name !== 'Alle').map(({ name }) => name);
    }

    // OperationTypes
    let selectedOperationTypes: string[] = [];
    if (_.isArray(this.options.selectOperationTypes)) {
      selectedOperationTypes = this.options.selectOperationTypes;
    } else if (_.isFunction(this.options.selectOperationTypes)) {
      selectedOperationTypes = await this.options.selectOperationTypes({ operationTypes });
    } else {
      throw new Error(`Period must be type of "Array" or "function" witch return an array!\nYou give "${typeof this
        .options.selectOperationTypes}"`);
    }
    if (selectedOperationTypes.includes('Alle') || selectedOperationTypes.length === 0) {
      selectedOperationTypes = operationTypes
        .filter(({ name }) => name !== 'Alle')
        .map(({ number }) => number);
    }

    if (this.options.scrapeType !== 'html') {
      return {
        periods: selectedPeriods.reduce<string[]>((pre, p) => {
          const period = periods.find(({ name }) => name === p);
          if (period) {
            return [...pre, period.value];
          }
          return pre;
        }, []),
        operationTypes: selectedOperationTypes.reduce<string[]>((pre, n) => {
          const operationType = operationTypes.find(({ number }) => number === n);
          if (operationType) {
            return [...pre, operationType.value];
          }
          return pre;
        }, []),
      };
    }
    return {
      periods: selectedPeriods.reduce<string[]>((pre, p) => {
        const period = periods.find(({ name }) => name === p);
        if (period) {
          return [...pre, period.name];
        }
        return pre;
      }, []),
      operationTypes: selectedOperationTypes.reduce<string[]>((pre, n) => {
        const operationType = operationTypes.find(({ number }) => number === n);
        if (operationType) {
          return [...pre, operationType.name.replace(`${n} - `, '')];
        }
        return pre;
      }, []),
    };
  };

  // async selectPeriod({ browser, periodName }: { browser: IStack; periodName: string }) {
  //   const period = this.availableFilters.periods.find(p => p.name === periodName);
  //   if (period) {
  //     await Promise.all([
  //       browser.page.waitForNavigation({ waitUntil: ['domcontentloaded'] }),
  //       browser.page.select('select#wahlperiode', period.value),
  //     ]).catch((error) => {
  //       throw {
  //         error,
  //         function: 'selectPeriod',
  //         code: 1005,
  //       };
  //     });
  //   }
  // }

  // async selectOperationTypes({ browser, operationTypeNumber }) {
  //   const operationType = this.availableFilters.operationTypes.find(o => o.number === operationTypeNumber);
  //   if (!operationType) {
  //     throw new Error(`OperationType "${operationTypeNumber}" not found`);
  //   }
  //   await browser.page.select('select#includeVorgangstyp', `${operationType.value}`);
  // }

  takeSearchableValues = async (browserObj: IStack) => {
    browserObj.used = true; // eslint-disable-line no-param-reassign
    const searchBody = await browserObj.browser.getBeratungsablaeufeSearchPage();
    const searchOptions = await browserObj.browser.getBeratungsablaeufeSearchOptions({
      body: searchBody,
    });
    if (searchOptions.vorgangstyp.length === 0) {
      throw new Error();
    }
    browserObj.used = false; // eslint-disable-line no-param-reassign
    return {
      periods: searchOptions.wahlperioden,
      operationTypes: searchOptions.vorgangstyp,
    };
  };

  startSearch = async ({
    browser,
    formData,
    formMethod,
    formAction,
  }: {
  browser: IStack;
  formData: IFormData;
  formMethod: any;
  formAction: any;
  }) => {
    const { body: searchResultBody } = await browser.browser.getSearchResultPage({
      formMethod,
      formAction,
      formData,
    });

    const resultInfos = await browser.browser.getResultInfo(searchResultBody);

    if (!resultInfos) {
      return;
    } else if (resultInfos === 'isEntry') {
      const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
      const vorgangIdMatches = searchResultBody.match(procedureIdRegex);
      if (vorgangIdMatches) {
        const vorgangId = vorgangIdMatches[1];
        this.procedures.push({
          id: vorgangId.split('-')[1],
          url: `/dip21.web/searchProcedures/simple_search_list.do?selId=${
            vorgangId.split('-')[1]
          }&method=select&offset=0&anzahl=200&sort=3&direction=desc`,
          scraped: false,
        });
      }
      return;
    }

    this.status.search.pages.sum += resultInfos.pageSum;
    let pagesCompleted = 0;
    let searchResultBodyToAnalyse = searchResultBody;
    for (let i = resultInfos.pageCurrent; i <= resultInfos.pageSum; i += 1) {
      try {
        if (i !== 1) {
          const searchFormData = await browser.browser.getBeratungsablaeufeSearchFormData(searchResultBodyToAnalyse);
          let { formData: newFormData } = searchFormData;
          const { formMethod: newFormMethod, formAction: newFormAction } = searchFormData;
          newFormData = { ...formData, ...newFormData };
          newFormData.method = '>'; // Next page can only be reached through this
          newFormData.offset = ((i - 1) * this.options.resultsPerPage).toString();
          const { body: tmpBody } = await browser.browser.getSearchResultPage({
            formMethod: newFormMethod,
            formAction: `http://${this.baseUrl}${newFormAction}`,
            formData: newFormData,
          });
          searchResultBodyToAnalyse = tmpBody;
        }

        let pageLinks = browser.browser.getEntries(searchResultBodyToAnalyse);
        pageLinks = pageLinks.filter(link =>
          (this.options.doScrape ? this.options.doScrape({ data: link }) : true));
        this.procedures.push(...pageLinks);
        this.status.search.pages.completed += 1;
        pagesCompleted += 1;
      } catch (error) {
        i = 1;
        this.status.search.pages.sum -= resultInfos.pageSum;
        this.status.search.pages.completed -= pagesCompleted;
        throw {
          error,
          function: 'startSearch',
          type: 'timeout',
          code: 1008,
        };
      }
      this.options.logUpdateSearchProgress(this.status);
    }
  };

  async saveJson({
    id,
    link,
    dipBrowser,
    scrapeVersion,
  }: {
  id: string;
  link: string;
  dipBrowser: DipBrowser;
  scrapeVersion: string;
  }) {
    const procedureIdRegex = /\[ID:&nbsp;(.*?)\]/;
    const { data: entryBody } = await dipBrowser.request(link);

    let procedureId;
    try {
      const procedureIdMatch = entryBody.match(procedureIdRegex);
      if (procedureIdMatch) {
        procedureId = procedureIdMatch[1];
      }
    } catch (error) {
      throw {
        error,
        code: 1012,
      };
    }
    const urlObj = Url.parse(link);
    let vorgangId = id;
    if (scrapeVersion !== 'html' && urlObj.query) {
      const queryObj = Querystring.parse(urlObj.query);
      vorgangId = (queryObj.selId as string) || id;
    }
    if (!procedureId) {
      throw new Error('ERROR Procedure id not found');
    }
    if (procedureId.split('-')[1] !== vorgangId) {
      const error = new Error(`Procedure ID missmatch URL: "${vorgangId}" to HTML: "${procedureId.split('-')[1]}"`);
      throw {
        error,
        code: 1013,
      };
    }

    const dataProcedure = await this.getProcedureData(entryBody);

    let procedureData;
    if (scrapeVersion !== 'html') {
      const { data: entryRunningBody } = await dipBrowser.request(`${this.urls.processRunning}${vorgangId}`);

      const dataProcedureRunning = await Scraper.getProcedureRunningData(entryRunningBody);

      procedureData = {
        vorgangId,
        ...dataProcedure,
        ...dataProcedureRunning,
      };
    } else {
      const { VORGANGSABLAUF } = dataProcedure.VORGANG;
      delete dataProcedure.VORGANG.VORGANGSABLAUF;

      if (
        this.options.liveScrapeStates.find((state: string) => dataProcedure.VORGANG.AKTUELLER_STAND === state)
      ) {
        const entryBodyMatches = entryBody.match(/<a class="linkExtern" href="(.*?)"><strong>Weitere Details in DIP...<\/strong><\/a>/);
        if (entryBodyMatches) {
          const dipLink = entryBodyMatches[1];
          await this.saveJson({
            id,
            link: dipLink,
            dipBrowser,
            scrapeVersion: 'live',
          });
        }
      } else {
        procedureData = {
          vorgangId,
          ...dataProcedure,
          VORGANGSABLAUF,
        };
      }
    }
    if (procedureData) {
      this.options.outScraperData({ procedureId, procedureData });
    }
  }

  getProcedureData = async (html: string) => {
    const xmlRegex = /<VORGANG>(.|[\r\n])*<\/VORGANG>/;
    const procedureDataMatch = html.match(xmlRegex);
    if (procedureDataMatch) {
      const xmlString = procedureDataMatch[0].replace('<- VORGANGSABLAUF ->', '');
      return x2j.xml2js<any>(xmlString);
    }
    throw new Error();
  };

  static async getProcedureRunningData(html: string) {
    const xmlRegex = /<VORGANGSABLAUF>(.|[\r\n])*<\/VORGANGSABLAUF>/;
    const htmlMatches = html.match(xmlRegex);
    if (htmlMatches) {
      const xmlString = htmlMatches[0];
      return x2j.xml2js<any>(xmlString);
    }
    throw new Error();
  }

  timeout = async ({ min, max } = { min: 1000, max: 5000 }) =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, _.random(min, max));
    });
}

module.exports = Scraper;
