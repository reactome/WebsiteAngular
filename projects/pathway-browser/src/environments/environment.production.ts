import { ENVIRONMENTS } from '../../../website-angular/src/config/environments';

const env = ENVIRONMENTS.production;

export const environment = {
  production: true,
  host: env.host,
  s3: env.s3,
  gsaServer: env.gsaServer,
  gtagId: env.gtagId,
  preferS3: env.preferS3
};

// Icon image files live on the Reactome backend and aren't proxied on every
// front-end origin; use the dev backend host (see environment.ts).
export const ICON_HOST = 'https://dev.reactome.org';

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
const schemaHost: string =
  typeof window !== 'undefined' ? window.location.origin : environment.host;
export const CONTENT_SCHEMA = `${schemaHost}/curatorgraph/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
