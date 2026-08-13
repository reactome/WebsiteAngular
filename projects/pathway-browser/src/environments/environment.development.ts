import { ENVIRONMENTS } from '../../../website-angular/src/config/environments';

const env = ENVIRONMENTS.development;

export const environment = {
  production: true,
  host: env.host,
  s3: env.s3,
  gsaServer: env.gsaServer,
  gtagId: env.gtagId,
  preferS3: env.preferS3
};

export const CONTENT_SERVICE = `${environment.host}/ContentService`;
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
export const CONTENT_SERVICE_FALLBACK = `https://newcurator.reactome.org/ContentService`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
// Diagram/EHLD assets are static files served at the site root, not under the
// /curatorgraph app base, so build this base URL from the root host.
export const DOWNLOAD = `${environment.host.replace(/\/curatorgraph\/?$/, '')}/download/current`;
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
