import DipBrowser from '../DipBrowser';

export interface IStatus {
  search: {
    instances: {
      sum: number;
      completed: number;
    };
    pages: {
      sum: number;
      completed: number;
    };
  };
}

export interface IOptions {
  selectPeriods: (periods: IAvailableFilters['periods']) => Promise<string[]> | string[];
  selectOperationTypes: any;
  logStartSearchProgress?: (status: IStatus) => void;
  logUpdateSearchProgress: (params: IStatus & { hasError?: boolean }) => Promise<void> | void;
  logStopSearchProgress?: () => void;
  logStartDataProgress: (args: { sum: number; retries: number }) => void;
  logUpdateDataProgress: ({
    value,
    retries,
    browsers,
    hasError,
  }: {
  value: any;
  retries: any;
  browsers: any;
  hasError?: boolean;
  }) => void;
  logStopDataProgress: () => void;
  logFinished: () => void;
  logError: ({ error }: any) => void;
  outScraperData: ({
    procedureId,
    procedureData,
  }: {
  procedureId: string;
  procedureData: any;
  }) => void;
  doScrape?: ({ data }: { data: any }) => boolean;
  browserStackSize: number;
  resultsPerPage?: any;
  scrapeType: 'html' | 'live';
  liveScrapeStates: any;
}

export interface IUrls {
  processRunning: string;
  search: string;
  dipUrl: string;
  startUrl: string;
}

export interface IStack {
  browser: DipBrowser;
  used: boolean;
  scraped: number;
  errors: number;
}

export interface IFilters {
  period: string;
  operationType?: string;
  operationTypes?: string[];
  scraped: boolean;
}

export interface IFormData {
  suchwort: string;
  nummer: string;
  wahlperiode: string;
  vorgangstyp?: string;
  method?: string;
  anzahlTreffer?: string;
  offset?: string;
}

export interface IProcedures {
  id: string;
  url: string;
  scraped: boolean;
}

export interface IAvailableFilters {
  periods: {
    name: string;
    value: string;
  }[];
  operationTypes: {
    name: string;
    number: string;
    value: string;
  }[];
}

export type IFormMethod = 'get' | 'GET' | 'post' | 'POST';
