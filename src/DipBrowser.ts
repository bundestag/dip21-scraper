import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosCookieJarSupport from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import qs from 'querystring';
import { IUrls, IFormData, IFormMethod } from './types';

axiosCookieJarSupport(axios);

class DipBrowser {
  cookie: CookieJar;
  urls: any = {};
  defReqOpt: any;
  api: AxiosInstance;

  constructor(urls: IUrls) {
    this.api = axios.create();
    this.urls = urls;
    this.cookie = new CookieJar();
  }

  initialize = async () => {
    await this.request(this.urls.startUrl, {
      ...this.defReqOpt,
    });
  };

  request = (url: string, opts?: AxiosRequestConfig) => {
    const reqOptions: AxiosRequestConfig = {
      timeout: 15000,
      method: 'GET',
      headers: {
        'User-Agent': process.env.SCRAPER_USER_AGEND || 'OpenData',
      },
      jar: this.cookie,
      withCredentials: true,
      ...opts,
    };

    if (url.substr(0, 4) !== 'http') {
      url = `${this.urls.dipUrl}${url}`;
    }

    return this.api.get<string>(url, reqOptions);
  };

  post = (url: string, opts: AxiosRequestConfig) => {
    const reqOptions: AxiosRequestConfig = {
      timeout: 15000,
      headers: {
        'User-Agent': process.env.SCRAPER_USER_AGEND || 'OpenData',
      },
      jar: this.cookie,
      withCredentials: true,
      ...opts,
    };

    if (url.substr(0, 4) !== 'http') {
      url = `${this.urls.dipUrl}${url}`;
    }
    return this.api.post<string>(url, qs.stringify(opts.data), reqOptions);
  };

  getBeratungsablaeufeSearchPage = async () => {
    const { data } = await this.request('/dip21.web/searchProcedures.do');
    return data;
  };

  getSelectOptions = ({ selectHtml }: { selectHtml: string }) => {
    const optionsHtml = selectHtml.match(/<option.*?>.*?<\/option>/g);
    if (optionsHtml) {
      return optionsHtml.reduce<{ name: string; value: string }[]>((pre, o) => {
        const oMatches = o.match(/<option.*?value="(.*?)".*?>(.*?)<\/option>/);
        if (oMatches) {
          return [
            ...pre,
            {
              name: oMatches[2],
              value: oMatches[1],
            },
          ];
        }
        return pre;
      }, []);
    }
    throw new Error('ERROR in getSelectOptions');
  };

  getBeratungsablaeufeSearchOptions = async ({ body }: { body: string }) => {
    const periodMatches = body.match(/<select name="wahlperiode".*?>(.|\s)*?<\/select>/);
    const operationTypesMatches = body.match(/<select name="vorgangstyp".*?>(.|\s)*?<\/select>/);

    if (periodMatches && operationTypesMatches) {
      const periods = this.getSelectOptions({
        selectHtml: periodMatches[0],
      });

      const operationTypes = this.getSelectOptions({
        selectHtml: operationTypesMatches[0],
      });
      const vorgangstyp = operationTypes.map(e => ({
        ...e,
        number: e.name.split(' - ')[0],
      }));
      return {
        wahlperioden: periods,
        vorgangstyp,
      };
    }
    throw new Error('ERROR in getBeratungsablaeufeSearchOptions');
  };

  getBeratungsablaeufeSearchFormData = async (body: string) => {
    const form = body.match(/<form.*?id="ProceduresSimpleSearchForm".*?method="(.*?)?".*?action="(.*?)?".*?>(.|[\r\n])*?<\/form>/);
    const re = /<input.*?type="hidden".*?name="(.*?)".*?value="(.*?)".*?>/g;
    if (form) {
      const method = form[1] as IFormMethod;
      const action = form[2];

      let m;
      const formData: IFormData = { suchwort: '', nummer: '', wahlperiode: '8' };

      do {
        m = re.exec(form[0]);
        if (m && (m[1] === 'suchwort' || m[1] === 'nummer' || m[1] === 'wahlperiode')) {
          formData[m[1]] = m[2];
        }
      } while (m);

      return {
        formData,
        formMethod: method,
        formAction: action,
      };
    }
    throw new Error('ERROR in getBeratungsablaeufeSearchFormData');
  };

  getSearchResultPage = async ({
    formMethod,
    formAction,
    formData,
  }: {
  formMethod: IFormMethod;
  formAction: string;
  formData: any;
  }) =>
    this.post(formAction, {
      method: formMethod,
      url: formAction,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: formData,
    }).then(d => ({
      body: d.data,
    }));

  getResultInfo = async (body: string) => {
    if (body.includes('Es konnte kein Datensatz gefunden werden.')) {
      return false;
    }
    const reg = /Seite (\d*) von (\d*) \(Treffer (\d*) bis (\d*) von (\d*)\)/;
    const paginator = body.match(reg);
    if (!paginator) {
      return 'isEntry';
    }
    return {
      pageCurrent: parseInt(paginator[1], 10),
      pageSum: parseInt(paginator[2], 10),
      entriesFrom: parseInt(paginator[3], 10),
      entriesTo: parseInt(paginator[4], 10),
      entriesSum: parseInt(paginator[5], 10),
    };
  };

  getEntries = (body: string) => {
    const table = body.match(/<table.*?summary="Ergebnisliste">(.|[\r\n])*?<\/table>/);
    if (table) {
      const re = /<a.*?href="(.*?)">(?:.|\s)*?<\/a>(?:.|\s)*?<\/td><td.*?>([0-9]*.[0-9]*.[0-9]*)<\/td>/g;
      let m;
      const data = [];
      do {
        m = re.exec(table[0]);
        if (m && m[1]) {
          const urlMatch = m[1].match(/selId=(\d.*?)&/);
          if (urlMatch) {
            data.push({
              id: urlMatch[1],
              url: m[1].replace('&amp;', '&'),
              date: m[2],
              scraped: false,
            });
          }
        }
      } while (m);

      return data;
    }
    throw new Error('ERROR in getEntries');
  };
}

export default DipBrowser;
