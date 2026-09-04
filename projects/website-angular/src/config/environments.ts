/**
 * The deployments this repository can build, one row each.
 *
 * A profile names both halves of a deployment: the backend it talks to and the
 * UI variant it presents. They used to be chosen by separate mechanisms -- the
 * backend by an APP_ENV define, the UI by swapping variant.ts through
 * fileReplacements -- and nothing kept the two in step. The curator site could
 * only reach its own backend by editing the *public* site's entry, so someone
 * did, and beta.reactome.org served the curation database to the curators
 * reviewing it. One row per deployment makes that particular mistake unsayable.
 *
 * Adding a deployment (Plant Reactome, say) is a row here plus whatever UI
 * genuinely differs -- not a new environment file, and not a new boolean.
 */

type SiteVariant = 'main' | 'curator';

export type ProfileName = 'production' | 'beta' | 'development' | 'curator' | 'curator-local';

export interface SiteProfile {
  /** Which UI this deployment presents. */
  variant: SiteVariant;
  /**
   * Where the services are, or `'origin'` for "wherever this bundle is served
   * from".
   *
   * `'origin'` is what the public deployments want, and it is not a convenience.
   * beta.reactome.org reverse-proxies its own /ContentService to the Tomcat on
   * its box, and that Tomcat serves endpoints the public one does not -- the
   * reaction-diagram exporter among them. Pointing beta at reactome.org by name
   * therefore breaks reaction pages, which is precisely what happened while this
   * field was a fixed string. A site should talk to itself.
   */
  host: 'origin' | string;
  /** Used when `host` is `'origin'` and there is no window: SSR, unit tests. */
  originFallback?: string;
  /**
   * Path appended to the host for the graph API. The curator site serves it
   * under /GraphContentService rather than /ContentService.
   */
  contentServicePath?: string;
  /**
   * Absolute override, for when the graph API is not on `host` at all -- a
   * locally run curator-service answers at its own root, with no path segment.
   */
  contentService?: string;
  s3: string;
  gsaServer: string;
  /**
   * Google Analytics property, and only reactome.org has one.
   *
   * Absent everywhere else on purpose: a deployment with no property does not
   * load gtag and reports nothing. Sending beta, dev or curation traffic to the
   * public property would inflate the public site's numbers with hits it never
   * received, and nobody reading them afterwards could separate the two.
   */
  gtagId?: string;
  /**
   * Take diagram JSON, EHLDs, figures and icons from the deployment's own host
   * instead of the release bucket.
   *
   * Absent is the norm: released assets live in the bucket, keyed by release
   * number, served by CloudFront with CORS. Only a deployment whose assets are
   * not in a release needs this -- the curator site's diagram JSON is derived
   * from the curation graph and is ahead of any release (18 nodes for Signal
   * Transduction against release 97's 17), so no bucket path holds it.
   *
   * Named for the exception rather than the norm on purpose: the old flag was
   * `preferS3`, which named the common case and read as a soft preference, and a
   * deployment that failed to set it silently fell back to a host path that in
   * some contexts nothing serves.
   */
  assetsFromHost?: true;
  /**
   * Where to ask for the database version when `contentService` cannot answer.
   *
   * Only a curation graph needs this: it has no released version, and one is
   * required to build S3 diagram URLs. A released deployment answers for itself,
   * so its "fallback" is its own service -- deliberately not another
   * deployment's, which would mean quietly reporting someone else's release.
   */
  versionFallback: string;
  /** Absolute, unless a proxy serves the assets at the root. */
  downloadBase?: string;
  /** Where the data-schema instance browser is mounted. */
  schemaPath: string;
}

const S3 = 'https://download.reactome.org';

export const SITE_PROFILES: Record<ProfileName, SiteProfile> = {
  production: {
    // The published artifact: `deploy.yml` builds this and syncs it to
    // s3://<bucket>/<version>/website/. It is served from the bucket, not from a
    // host that proxies the services -- so unlike the deployments below it
    // cannot use its own origin. download.reactome.org answers 403 for
    // /ContentService, and every call would fail.
    //
    // It names beta because beta is the only host serving the whole set the app
    // needs. reactome.org has no /RenderService and no /overlays, so figure
    // rendering and overlays would be dead there today. When those move to
    // reactome.org this becomes one line.
    //
    // Cross-origin from the bucket works: ContentService and AnalysisService
    // send Access-Control-Allow-Origin: *, and RenderService is only ever an
    // <img src> or a download href, where CORS does not apply.
    variant: 'main',
    host: 'https://beta.reactome.org',
    s3: S3,
    gsaServer: 'production',
    gtagId: 'G-EDHZ92GXZP',
    versionFallback: 'https://beta.reactome.org/ContentService/data/database/version',
    schemaPath: '/dataSchema',
  },
  beta: {
    // beta.reactome.org: a production-shaped build of the public site, served
    // from its own origin against the dev backend behind it. It is a deployment
    // in its own right and not "production served elsewhere" -- most visibly in
    // analytics, where its traffic must not land in the public property.
    variant: 'main',
    host: 'origin',
    originFallback: 'https://beta.reactome.org',
    s3: S3,
    gsaServer: 'production',
    versionFallback: 'https://beta.reactome.org/ContentService/data/database/version',
    schemaPath: '/dataSchema',
  },

  development: {
    variant: 'main',
    host: 'origin',
    originFallback: 'https://dev.reactome.org',
    s3: S3,
    gsaServer: 'dev',
    versionFallback: 'https://dev.reactome.org/ContentService/data/database/version',
    schemaPath: '/dataSchema',
  },
  curator: {
    variant: 'curator',
    host: 'https://newcurator.reactome.org',
    contentServicePath: '/GraphContentService',
    s3: S3,
    gsaServer: 'production',
    // No analytics property for the curator site yet. Deliberately absent rather
    // than borrowed: pointing it at the public property would file curation
    // traffic as public traffic, and nobody looking at those numbers would know.
    assetsFromHost: true,
    // A curation graph has no released version, so this asks the released
    // instance on the same host -- not a different deployment.
    // The curator host cannot report a release number: its GraphContentService
    // answers 500 for the version, and the /ContentService this used to name does
    // not exist there at all -- it 404s, so this fallback had never once worked.
    // The number is needed to key bucket paths for the assets curator does take
    // from the release (figures, icons, EHLDs), so it comes from the public site,
    // which is the authority on which release is current.
    versionFallback: 'https://reactome.org/ContentService/data/database/version',
    schemaPath: '/curatorgraph/dataSchema',
  },
  'curator-local': {
    variant: 'curator',
    // Only the graph content API runs locally. The analysis and experiment
    // services, downloads and detail pages have no local equivalent.
    host: 'https://newcurator.reactome.org',
    contentService: 'http://localhost:8686',
    s3: S3,
    gsaServer: 'dev',
    assetsFromHost: true,
    versionFallback: 'https://reactome.org/ContentService/data/database/version',
    // Proxied at the root by proxy.curator-local.conf.json, because
    // newcurator.reactome.org/download sends no Access-Control-Allow-Origin.
    downloadBase: '/download/current',
    schemaPath: '/curatorgraph/dataSchema',
  },
};

// Build-time selector. The `define` option in angular.json replaces this
// identifier with a string literal per build configuration, so it works in the
// browser and under SSR without a `process` shim. A configuration that sets no
// define leaves the identifier absent, which is why this is read through
// `typeof`.
declare const APP_ENV: string | undefined;

function buildTimeProfileName(): string | undefined {
  return typeof APP_ENV !== 'undefined' ? APP_ENV : undefined;
}

// Runtime override, for host pages that embed the pathway-browser element and
// need to choose a deployment without rebuilding. Takes precedence.
function runtimeProfileName(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __APP_ENV?: string }).__APP_ENV || undefined;
}

export const SELECTED_PROFILE_NAME: string | undefined =
  runtimeProfileName() ?? buildTimeProfileName();

/**
 * The deployment a build is for.
 *
 * No name means `production`: that is what a bare `ng build` is for, and the
 * public site is the safe default to be wrong about. A name that is *not* a
 * profile is a different matter -- a typo in a define, or a profile renamed
 * while a configuration still asks for it. Answering that with production would
 * point a build confidently at the wrong backend and say nothing, which is the
 * shape of the failure that put curation data on the public beta. It throws
 * instead, at startup, where it can be seen.
 */
export function getProfile(name?: string): SiteProfile {
  if (!name) return SITE_PROFILES.production;
  const profile = SITE_PROFILES[name as ProfileName];
  if (!profile) {
    throw new Error(
      `Unknown APP_ENV "${name}". Known deployments: ${Object.keys(SITE_PROFILES).join(', ')}.`
    );
  }
  return profile;
}
