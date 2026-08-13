import { getEnv, SELECTED_ENV_NAME } from '../../../website-angular/src/config/environments';

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
}

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
// /curatorgraph app base, so build this base URL from the root host.
export const DOWNLOAD = `${environment.host.replace(/\/curatorgraph\/?$/, '')}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
// Path-only form for use with Angular RouterLink (which interprets absolute
// URLs as relative paths and concatenates them onto the current route).
export const CONTENT_DETAIL_PATH = '/content/detail';
// Build person/schema links from the hosting app shell's base URL so they keep
// working wherever the widget is deployed. document.baseURI resolves the page's
// <base href> against the current origin, which yields "/" under `ng serve` and
// "/curatorgraph/" on the deployed curator site - hardcoding "/curatorgraph"
// here appended a second copy of that segment in local dev.
const schemaHost: string =
  typeof document !== 'undefined'
    ? document.baseURI.replace(/\/+$/, '')
    : environment.host;
// Full-host base for the curator data-schema instance browser, used to build
// author/person links so they resolve on the deployed host regardless of where
// the embeddable pathway-browser element is hosted.
export const CONTENT_SCHEMA = `${schemaHost}/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
