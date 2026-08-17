import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

// Resolve the host from the browser's current origin so URLs built from
// environment.host stay on whatever site the user is on -- beta.reactome.org,
// release.reactome.org, reactome.org, localhost during dev. The fallback
// applies when this module is imported in a non-browser context (e.g. unit
// tests, build-time tooling) where window doesn't exist.
//
// The curator variant is the exception: it's a separate deployment
// (newcurator.reactome.org) with its own backend, so it always points there
// regardless of what domain the frontend bundle is actually being served
// from -- e.g. when previewing the curator build under a path on a different
// host for testing purposes.
const host: string = IS_CURATOR
  ? 'https://newcurator.reactome.org'
  : typeof window !== 'undefined'
    ? window.location.origin
    : 'https://dev.reactome.org';

export const environment = {
  production: false,
  host,
  s3: 'https://download.reactome.org',
  gsaServer: 'dev',
  gtagId: 'G-96F1EYHQR3',
  // The curator database isn't released/versioned the way the public site's
  // is -- data/database/version has nothing meaningful to return there (see
  // general.service.ts) -- so don't route diagram downloads through the
  // version-keyed S3 path for curator.
  preferS3: !IS_CURATOR,
};

// Icon image files (.svg/.png under /icon/) are static reference assets served
// by the Reactome backend, not by the Angular app. Unlike /ContentService they
// are NOT reverse-proxied on every front-end origin (e.g. beta.reactome.org
// returns 404), so build their URLs from the dev backend host rather than
// window.location.origin. The assets send Access-Control-Allow-Origin: *, so
// cross-origin <img> loads work from any front-end.
export const ICON_HOST = 'https://dev.reactome.org';

// The curator host serves icon assets itself (no cross-origin proxying
// limitation like beta/release/production have), so use it directly instead
// of falling back to ICON_HOST.
export const ICON_BASE = IS_CURATOR ? environment.host : ICON_HOST;

// The curator variant points at a separate graph database (curation data,
// not the released production graph), served under a different context path
// on the same backend.
export const CONTENT_SERVICE = `${environment.host}/${IS_CURATOR ? 'GraphContentService' : 'ContentService'}`;
// CORS-enabled public endpoint used only as a fallback to resolve the current
// database version when the primary CONTENT_SERVICE version call fails. The
// version is needed to build CORS-enabled S3 diagram URLs. Only relevant to
// the curator variant, where the primary CONTENT_SERVICE is the curation
// backend rather than the always-on public one.
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
// CORS-enabled public content service. Used as a fallback for version-static
// metadata endpoints (e.g. the data-schema model) when the primary curator
// CONTENT_SERVICE is slow or unavailable, so those pages still render.
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
// Curator-only: base for the curation data-schema instance browser, used to
// build author/person links from the schema pages. Not used by the main site.
export const CONTENT_SCHEMA = `${environment.host}/curatorgraph/dataSchema`;
