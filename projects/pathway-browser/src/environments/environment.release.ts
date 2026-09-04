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
// The headless render service: diagram figures for documents (GIF, PPTX, PDF),
// rendered by the site's own renderer rather than by the Java exporters'
// reimplementation of it. Served under the site's own origin by a proxy, so a
// render can only be commissioned through whatever fronts the site.
export const RENDER_SERVICE = `${environment.host}/RenderService`;

// The IDG pairwise service (reactome-idg/idg-pairwise-ws), which relates a gene
// or protein to Reactome pathways through third-party interaction datasets.
// Absolute and cross-origin on purpose: the service answers with
// Access-Control-Allow-Origin, and its data lives on the IDG server rather than
// here. When that data moves, this is the line that changes.
export const IDG_SERVICE = 'https://idg.reactome.org/idgpairwise';
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;

// The experiment digester, as the *analysis service* must address it -- not as
// the browser does.
//
// Tissue analysis hands the analysis service a URL and that service fetches it
// server-side, so this has to resolve from inside the backend rather than from
// the page. It used to read https://127.0.0.1/ExperimentDigester/..., which the
// analysis service cannot fetch -- it answers 422 -- because nothing there
// terminates TLS for that name. Plain HTTP to the Tomcat both services share
// works, and avoids sending the request out through the public hostname and back,
// which is the hairpin that took Apache down with 522s once already.
export const DIGESTER_FOR_BACKEND = 'http://localhost:8080/ExperimentDigester';
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
// Resolve against the hosting page's <base href> ("/" locally, "/curatorgraph/"
// when deployed) instead of hardcoding the deployed path segment.
const schemaHost: string =
  typeof document !== 'undefined' ? document.baseURI.replace(/\/+$/, '') : environment.host;
export const CONTENT_SCHEMA = `${schemaHost}/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
