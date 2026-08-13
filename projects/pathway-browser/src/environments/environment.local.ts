import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

export const environment = {
  production: false,
  host: IS_CURATOR ? "https://newcurator.reactome.org" : "https://dev.reactome.org",
  s3: "https://download.reactome.org",
  gsaServer: "dev",
  gtagId: "G-96F1EYHQR3",
  preferS3: false,
};

// Icon image files live on the Reactome backend and aren't proxied on every
// front-end origin; use the dev backend host (see environment.ts).
export const ICON_HOST = 'https://dev.reactome.org';

// Curator local dev points at the remote curation backend directly (running
// a full local curation graph DB isn't practical); main local dev points at
// a locally-run ContentService instance.
export const CONTENT_SERVICE = IS_CURATOR ? `${environment.host}/ContentService` : `http://127.0.0.1:8686`;
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
export const CONTENT_QUERY = `${environment.host}/content/query`;
export const CONTENT_SCHEMA = `${environment.host}/curatorgraph/dataSchema`;
