/**
 * Every backend URL the app uses, derived from the selected deployment.
 *
 * There is one of these files now. There used to be eight, each re-exporting the
 * same eighteen constants with a few values changed, swapped in by
 * fileReplacements. Five were reachable from no build at all, and the curator
 * copy had drifted until it was missing three exports, which is why
 * `npm run build:curator` did not compile. A deployment is a row in
 * SITE_PROFILES now; this file reads it.
 *
 * If a page needs a backend URL, import it from here. Do not rebuild one from
 * `host` at the call site.
 */
import {
  getProfile,
  SELECTED_PROFILE_NAME,
} from '../../../website-angular/src/config/environments';

const profile = getProfile(SELECTED_PROFILE_NAME);

// Which UI to present. Not exported while there are only two variants and every
// caller asks the same yes/no question below; export it when a third arrives, so
// callers switch on the variant instead of gaining a second boolean.
const SITE_VARIANT = profile.variant;

/**
 * Kept as a named export because 26 files ask this question. New deployments
 * should compare SITE_VARIANT instead of growing a second boolean beside it.
 */
export const IS_CURATOR = SITE_VARIANT === 'curator';

/**
 * Where this build's services live.
 *
 * `'origin'` means "wherever this bundle is served from", which is what the
 * public deployments want: beta.reactome.org proxies its own /ContentService to
 * the Tomcat on its box, and that Tomcat serves endpoints the public one does
 * not -- the reaction-diagram exporter among them. Naming a host instead broke
 * reaction pages on beta for exactly that reason. The fallback applies only off
 * the browser, in SSR and unit tests.
 */
const resolvedHost =
  profile.host === 'origin'
    ? typeof window !== 'undefined'
      ? window.location.origin
      : (profile.originFallback ?? '')
    : profile.host;

// Normalised so building URLs cannot produce a double slash.
const host = resolvedHost.replace(/\/+$/, '');

export const environment = {
  production: SELECTED_PROFILE_NAME === 'production',
  host,
  s3: profile.s3,
  gsaServer: profile.gsaServer,
  gtagId: profile.gtagId,
  assetsFromHost: profile.assetsFromHost === true,
};

// Icon image files (.svg/.png under /icon/) are static reference assets served
// by the Reactome backend, not by the Angular app. Unlike /ContentService they
// are NOT reverse-proxied on every front-end origin (beta.reactome.org returns
// 404), so the main variant builds their URLs from the dev backend. The assets
// send Access-Control-Allow-Origin: *, so cross-origin <img> loads work from any
// front end. The curator host serves its own icon assets and needs no such
// detour.
const ICON_HOST = 'https://dev.reactome.org';
export const ICON_BASE = IS_CURATOR ? host : ICON_HOST;

// Absolute only where the graph API is not on `host` at all (a locally run
// curator-service answers at its own root); otherwise a path on this host.
export const CONTENT_SERVICE = (
  profile.contentService ?? `${host}${profile.contentServicePath ?? '/ContentService'}`
).replace(/\/+$/, '');

// Used only when CONTENT_SERVICE cannot answer for the database version, which
// in practice means a curation graph -- it has no released version, and one is
// needed to build S3 diagram URLs. Each profile names its own; none names another
// deployment's.
//
// There was a CONTENT_SERVICE_FALLBACK beside this, pointing at a different
// deployment's content service for "when the primary is slow or unavailable".
// Nothing read it, and nothing should: answering from another deployment renders
// someone else's data without saying so.
export const VERSION_FALLBACK = profile.versionFallback;

export const ANALYSIS_SERVICE = `${host}/AnalysisService`;

// The headless render service: diagram figures for documents (GIF, PPTX, PDF),
// drawn by the site's own renderer rather than the Java exporters'
// reimplementation of it. Served under the site's own origin by a proxy, so a
// render can only be commissioned through whatever fronts the site.
export const RENDER_SERVICE = `${host}/RenderService`;

// The IDG pairwise service (reactome-idg/idg-pairwise-ws), relating a gene or
// protein to Reactome pathways through third-party interaction datasets.
// Absolute and cross-origin on purpose: it answers with
// Access-Control-Allow-Origin, and its data lives on the IDG server rather than
// here. When that data moves, this is the line that changes.
export const IDG_SERVICE = 'https://idg.reactome.org/idgpairwise';

// The experiment digester, as the *analysis service* must address it -- not as
// the browser does.
//
// Tissue analysis hands the analysis service a URL and that service fetches it
// server-side, so this has to resolve from inside the backend rather than from
// the page. It used to read https://127.0.0.1/ExperimentDigester/..., which the
// analysis service cannot fetch -- it answers 422 -- because nothing there
// terminates TLS for that name. Plain HTTP to the Tomcat both services share
// works, and avoids sending the request out through the public hostname and
// back, which is the hairpin that took Apache down with 522s once already.
export const DIGESTER_FOR_BACKEND = 'http://localhost:8080/ExperimentDigester';

export const RESTFUL_API = `${host}/ReactomeRESTfulAPI/RESTfulWS`;

// Diagram/EHLD assets are static files at the site root, not under an app base
// segment. A profile overrides this only where a proxy serves them locally.
export const DOWNLOAD = profile.downloadBase ?? `${host}/download/current`;

export const OVERLAYS = `${host}/overlays`;
export const CONTENT_DETAIL = `${host}/content/detail`;

// Path-only form for RouterLink, which treats an absolute URL as a relative
// path and concatenates it onto the current route.
export const CONTENT_DETAIL_PATH = '/content/detail';

// Person and schema links are built from the hosting shell's base URL so they
// keep working wherever the widget is deployed. document.baseURI resolves the
// page's <base href> against the current origin, which yields "/" under
// `ng serve` and "/curatorgraph/" on the deployed curator site -- hardcoding the
// segment appended a second copy of it in local dev.
const schemaHost: string =
  typeof document !== 'undefined' ? document.baseURI.replace(/\/+$/, '') : host;
export const CONTENT_SCHEMA = IS_CURATOR
  ? `${host}${profile.schemaPath}`
  : `${schemaHost}${profile.schemaPath}`;

export const CONTENT_QUERY = `${host}/content/query`;
