const request = require('request');

class DipBrowser {
  cookie = null;
  urls = {};
  type = 'live';

  constructor(urls, { type }) {
    this.urls = urls;
    this.cookie = request.jar();
    this.type = type;
  }

  initialize = async () => {
    await this.request({
      ...this.defReqOpt,
      uri: this.urls.startUrl,
    });
  };

  request = (opts) => {
    const reqOptions = {
      timeout: 15000,
      method: 'GET',
      jar: this.cookie,
      ...opts,
    };

    if (reqOptions.uri.substr(0, 4) !== 'http') {
      reqOptions.uri = `${this.urls.dipUrl}${reqOptions.uri}`;
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
    const form = body.match(/<form.*?id="ProceduresSimpleSearchForm".*?method="(.*?)?".*?action="(.*?)?".*?>(.|[\r\n])*?<\/form>/);
    const method = form[1];
    const action = form[2];

    const re = /<input.*?type="hidden".*?name="(.*?)".*?value="(.*?)".*?>/g;
    let m;
    const formData = { suchwort: '', nummer: '', wahlperiode: '8' };

    do {
      m = re.exec(form[0]);
      if (m) {
        formData[m[1]] = m[2]; // eslint-disable-line prefer-destructuring
      }
    } while (m);

    return {
      formData,
      formMethod: method,
      formAction: action,
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
      pageCurrent: parseInt(paginator[1], 10),
      pageSum: parseInt(paginator[2], 10),
      entriesFrom: parseInt(paginator[3], 10),
      entriesTo: parseInt(paginator[4], 10),
      entriesSum: parseInt(paginator[5], 10),
    };
  };

  getEntries = ({ body }) => {
    const table = body.match(/<table summary="Ergebnisliste">(.|[\r\n])*?<\/table>/);

    const re = /<a.*?class="linkIntern".*?href="(.*?)">(?:.|\s)*?<\/a>(?:.|\s)*?<\/td><td>([0-9]*.[0-9]*.[0-9]*)<\/td>/g;
    let m;
    const data = [];
    do {
      m = re.exec(table[0]);
      if (m) {
        data.push({
          id: m[1].match(/selId=(\d.*?)&/)[1],
          url: m[1].replace('&amp;', '&'),
          date: m[2],
          scraped: false,
        });
      }
    } while (m);

    return data;
  };
}

export default DipBrowser;
