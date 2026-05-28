// Resolve the host from the browser's current origin so URLs built from
// environment.host stay on whatever site the user is on -- beta.reactome.org,
// release.reactome.org, reactome.org, localhost during dev. The fallback
// applies when this module is imported in a non-browser context (e.g. unit
// tests, build-time tooling) where window doesn't exist.
const host: string =
  typeof window !== 'undefined' ? window.location.origin : 'https://dev.reactome.org';

export const environment = {
  production: false,
  host: "https://curator.reactome.org",
  s3: "https://download.reactome.org",
  gsaServer: "dev",
  gtagId: "G-96F1EYHQR3",
  preferS3: true,
}

export const CONTENT_SERVICE = `https://curator.reactome.org/GraphContentService`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
// Path-only form for use with Angular RouterLink (which interprets absolute
// URLs as relative paths and concatenates them onto the current route).
export const CONTENT_DETAIL_PATH = '/content/detail';
export const CONTENT_QUERY = `${environment.host}/content/query`;
