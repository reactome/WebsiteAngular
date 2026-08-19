import { getEnv, SELECTED_ENV_NAME } from '../../../website-angular/src/config/environments';
import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

const selectedEnv = getEnv(SELECTED_ENV_NAME);

// Normalize host to avoid accidental double slashes when building URLs.
const host = selectedEnv.host.replace(/\/+$/, '');

export const environment = {
  production: false,
  host,
  s3: selectedEnv.s3,
  gsaServer: selectedEnv.gsaServer,
  gtagId: selectedEnv.gtagId,
  preferS3: selectedEnv.preferS3,
};

// Icon image files (.svg/.png under /icon/) are static reference assets served
// by the Reactome backend, not by the Angular app. Unlike /ContentService they
// are NOT reverse-proxied on every front-end origin (e.g. beta.reactome.org
// returns 404), so build their URLs from the dev backend host. The assets send
// Access-Control-Allow-Origin: *, so cross-origin <img> loads work from any
// front-end.
export const ICON_HOST = 'https://dev.reactome.org';

// The curator host serves icon assets itself (no cross-origin proxying
// limitation like beta/release/production have), so use it directly instead
// of falling back to ICON_HOST.
export const ICON_BASE = IS_CURATOR ? environment.host : ICON_HOST;

// Base URL the app appends /data, /search, /exporter and /interactors to. Comes
// from the environment rather than being derived from `host` because a local
// curator-service serves those routes at its root, with no path segment.
export const CONTENT_SERVICE = selectedEnv.contentService.replace(/\/+$/, '');
// CORS-enabled public endpoint used only as a fallback to resolve the current
// database version when the primary CONTENT_SERVICE version call fails. The
// version is needed to build CORS-enabled S3 diagram URLs.
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
// CORS-enabled public content service. Used as a fallback for version-static
// metadata endpoints (e.g. the data-schema model) when the primary curator
// CONTENT_SERVICE is slow or unavailable, so those pages still render.
export const CONTENT_SERVICE_FALLBACK = `https://newcurator.reactome.org/ContentService`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
// Diagram/EHLD assets are static files served at the site root, not under the
// /curatorgraph app base. `host` is already a bare origin (no app path segment),
// so it needs no stripping.
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
// Path-only form for use with Angular RouterLink (which interprets absolute
// URLs as relative paths and concatenates them onto the current route).
export const CONTENT_DETAIL_PATH = '/content/detail';
// Unlike environment.ts, which resolves this against the hosting page's
// <base href> (document.baseURI) and so keeps schema links on whatever origin
// serves the bundle, this variant pins them to the deployed curator site. That
// is the point of the `curator` configuration: run the bundle from `ng serve`
// while every endpoint, including the data-schema instance browser, is the
// deployed one. Consequence: following a person/schema link navigates off
// localhost to newcurator.
export const CONTENT_SCHEMA = `${environment.host}/curatorgraph/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
