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
// Not exported any more: icons come from the release bucket now, and this is
// only the fallback ICON_BASE uses until the release resolves (and on curator).
const ICON_HOST = 'https://dev.reactome.org';

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
// Diagram/EHLD assets are static files served at the site root, not under the
// /curatorgraph app base. `host` is already a bare origin (no app path segment),
// so it needs no stripping.
export const DOWNLOAD = `${environment.host}/download/current`;
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
  typeof document !== 'undefined' ? document.baseURI.replace(/\/+$/, '') : environment.host;
// Full-host base for the curator data-schema instance browser, used to build
// author/person links so they resolve on the deployed host regardless of where
// the embeddable pathway-browser element is hosted.
export const CONTENT_SCHEMA = `${schemaHost}/dataSchema`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
