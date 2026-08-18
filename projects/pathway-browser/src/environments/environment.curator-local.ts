import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

// Curator variant against a content service running on the developer's own
// machine (see the `curator-local` build/serve configuration in angular.json,
// which pairs this file with variant.curator.ts).
//
// `host` stays on the deployed curator backend: only the graph content API is
// available locally, so icons, the analysis/experiment services and the
// content/detail links still have to resolve against newcurator.
const host = 'https://newcurator.reactome.org';

export const environment = {
  production: false,
  host,
  s3: 'https://download.reactome.org',
  gsaServer: 'dev',
  gtagId: 'G-96F1EYHQR3',
  // The local curation graph has no released version to key S3 diagram paths
  // on (see environment.ts), so fetch diagrams from the content service.
  preferS3: false,
};

// Icon image files live on the Reactome backend and aren't proxied on every
// front-end origin; use the dev backend host (see environment.ts).
export const ICON_HOST = 'https://dev.reactome.org';
export const ICON_BASE = environment.host;

// A locally-run content service is a bare Spring Boot app: its endpoints sit
// at the root, not under the /ContentService or /GraphContentService context
// path the deployed instances are reverse-proxied onto. It sends
// Access-Control-Allow-Origin: *, so the dev server can call it cross-origin.
export const LOCAL_CONTENT_SERVICE_PORT = 8686;
export const CONTENT_SERVICE = `http://localhost:${LOCAL_CONTENT_SERVICE_PORT}`;
// data/database/version has nothing meaningful to return on a curation graph,
// so the version falls back to the public content service. newcurator's own
// /ContentService is a 404 (it only serves GraphContentService), so use
// reactome.org, which sends Access-Control-Allow-Origin: *.
export const VERSION_FALLBACK = `https://reactome.org/ContentService/data/database/version`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
// EHLDs and pre-generated diagram JSON aren't served by a local content
// service, and newcurator's /download sends no Access-Control-Allow-Origin,
// so go through the dev server: proxy.curator-local.conf.json forwards
// /download to newcurator, keeping these requests same-origin.
export const DOWNLOAD = `/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
export const CONTENT_QUERY = `${environment.host}/content/query`;
export const CONTENT_SCHEMA = `${environment.host}/curatorgraph/dataSchema`;
