export const environment = {
  production: false,
  host: "https://newcurator.reactome.org",
  s3: "https://download.reactome.org",
  gsaServer: "dev",
  gtagId: "G-96F1EYHQR3",
  preferS3: false,
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
const schemaHost: string =
  typeof window !== 'undefined' ? window.location.origin : environment.host;
export const CONTENT_SCHEMA = `${schemaHost}/curatorgraph/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
