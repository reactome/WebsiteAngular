import { getEnv, SELECTED_ENV_NAME } from '../../../website-angular/src/config/environments';
import { SITE_VARIANT } from './variant';

export const IS_CURATOR = SITE_VARIANT === 'curator';

const selectedEnv = getEnv(SELECTED_ENV_NAME);

// Named here rather than inherited, and deliberately so.
//
// This used to read selectedEnv.host, and the `curator` build configuration
// defines no APP_ENV -- so getEnv() fell through to ENVIRONMENTS.production.
// That made the *public* site's environment the only lever for pointing the
// curator site at its own backend, and 8289afd duly pulled it: production moved
// to newcurator, and beta.reactome.org began serving the curation database to
// the curators reviewing it.
//
// The curator site names its own host, the public site names its own, and
// neither can move the other by accident. environment.curator-local.ts already
// worked this way.
const host = 'https://newcurator.reactome.org';

export const environment = {
  production: false,
  host,
  s3: selectedEnv.s3,
  gsaServer: selectedEnv.gsaServer,
  gtagId: selectedEnv.gtagId,
  // Not inherited from the selected environment: that resolves to `production`
  // here, which prefers S3. S3 diagram paths are keyed on a released database
  // version and the curation graph has none (see environment.curator-local.ts),
  // so diagrams have to come from the content service.
  preferS3: false,
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
// Same reasoning as `host` above: stated, not inherited. The curator deployment
// serves the graph API under /GraphContentService.
export const CONTENT_SERVICE = 'https://newcurator.reactome.org/GraphContentService';
// CORS-enabled public endpoint used only as a fallback to resolve the current
// database version when the primary CONTENT_SERVICE version call fails. The
// version is needed to build CORS-enabled S3 diagram URLs.
export const VERSION_FALLBACK = `https://newcurator.reactome.org/ContentService/data/database/version`;
// CORS-enabled public content service. Used as a fallback for version-static
// metadata endpoints (e.g. the data-schema model) when the primary curator
// CONTENT_SERVICE is slow or unavailable, so those pages still render.
// Three exports the curator variant was missing, which is why
// `npm run build:curator` failed with TS2305 before its first line of output:
// detail-download-bar imports RENDER_SERVICE, idg.service imports IDG_SERVICE,
// and the experiment digester import needs DIGESTER_FOR_BACKEND. A variant file
// stands in for environment.ts wholesale, so it has to carry everything
// environment.ts exports or the build cannot resolve the import.
export const RENDER_SERVICE = `${host}/RenderService`;

// Not host-derived: IDG data lives on the IDG server, wherever the front end is.
export const IDG_SERVICE = 'https://idg.reactome.org/idgpairwise';

// Loopback on purpose -- see the note in environment.ts. The digester is called
// by the backend, not the browser, so this must not go out through the public
// hostname and back.
export const DIGESTER_FOR_BACKEND = 'http://localhost:8080/ExperimentDigester';

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
