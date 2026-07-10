export const environment = {
  production: false,
  host: "https://dev.reactome.org",
  s3: "https://download.reactome.org",
  gsaServer: "dev",
  gtagId: "G-96F1EYHQR3",
  preferS3: true,
};

// Icon image files live on the Reactome backend and aren't proxied on every
// front-end origin; use the dev backend host (see environment.ts).
export const ICON_HOST = 'https://dev.reactome.org';

export const CONTENT_SERVICE = `${environment.host}/ContentService`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
export const CONTENT_QUERY = `${environment.host}/content/query`;
