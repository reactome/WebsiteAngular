import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

export const environment = {
  production: true,
  host: IS_CURATOR ? 'https://newcurator.reactome.org' : '../..', // For go back from /beta/PathwayBrowser
  s3: 'https://download.reactome.org',
  gsaServer: 'dev',
  gtagId: 'G-ZCVRDTGMQJ',
  preferS3: false,
};

// Icon image files live on the Reactome backend and aren't proxied on every
// front-end origin; use the dev backend host (see environment.ts).
export const ICON_HOST = 'https://dev.reactome.org';

// The curator host serves icon assets itself, so use it directly there rather
// than falling back to ICON_HOST (see environment.ts).
export const ICON_BASE = IS_CURATOR ? environment.host : ICON_HOST;

export const CONTENT_SERVICE = `${environment.host}/${IS_CURATOR ? 'GraphContentService' : 'ContentService'}`;
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
// Resolve against the hosting page's <base href> ("/" locally, "/curatorgraph/"
// when deployed) instead of hardcoding the deployed path segment.
const schemaHost: string =
  typeof document !== 'undefined'
    ? document.baseURI.replace(/\/+$/, '')
    : environment.host;
export const CONTENT_SCHEMA = `${schemaHost}/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
