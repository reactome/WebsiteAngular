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

export const CONTENT_SERVICE = `${environment.host}/${IS_CURATOR ? 'GraphContentService' : 'ContentService'}`;
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
// The headless render service: diagram figures for documents (GIF, PPTX, PDF),
// rendered by the site's own renderer rather than by the Java exporters'
// reimplementation of it. Served under the site's own origin by a proxy, so a
// render can only be commissioned through whatever fronts the site.
export const RENDER_SERVICE = `${environment.host}/RenderService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_DETAIL_PATH = '/content/detail';
export const CONTENT_QUERY = `${environment.host}/content/query`;
export const CONTENT_SCHEMA = `${environment.host}/curatorgraph/dataSchema`;
