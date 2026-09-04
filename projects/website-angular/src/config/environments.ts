export type EnvName = 'development' | 'production' | 'local' | 'github' | 'remote';

export interface EnvConfig {
  host: string;
  // Full base URL of the graph content service, kept separate from `host`
  // because the path segment differs per deployment: the curator site serves it
  // under /GraphContentService, while a locally run curator-service serves the
  // same routes (/data, /search, /exporter, /interactors) straight off its root.
  contentService: string;
  s3: string;
  gsaServer: string;
  gtagId?: string;
  preferS3?: boolean;
}

// No entry here points at the curator host. The curator site is a build
// variant, not an environment: `--configuration curator` swaps in
// environment.curator.ts, and `curator-local` swaps in
// environment.curator-local.ts, both of which name their own hosts outright.
// Keeping the two apart is deliberate -- while a curator host sat in this map,
// `production` was the only lever that reached it, and pulling that lever put
// the curation database on beta.reactome.org.
export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  development: {
    host: 'https://dev.reactome.org',
    contentService: 'https://dev.reactome.org/ContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    gtagId: 'G-96F1EYHQR3',
    preferS3: false,
  },
  production: {
    // The public site, and it must stay public. 8289afd ("stash.") repointed this
    // at the curator host, and because getEnv() falls back to `production` when no
    // APP_ENV is defined -- which is every non-curator build -- beta.reactome.org
    // silently began serving the curator database. Its event hierarchy grew
    // "GOCAM test events", "Krishna: NRF2-KEAP1 pathway" and other draft
    // pathways, on the site curators were reviewing at the time.
    host: 'https://reactome.org',
    contentService: 'https://reactome.org/ContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    gtagId: 'G-EDHZ92GXZP',
    preferS3: true,
  },
  local: {
    // Running the site locally against the dev backend. This is the non-curator
    // local workflow: for the curator one, whose content service runs on
    // localhost:8686, use the `curator-local` build configuration -- it pairs
    // variant.curator.ts with environment.curator-local.ts, which names its own
    // hosts and does not read this map at all.
    host: 'https://dev.reactome.org',
    contentService: 'https://dev.reactome.org/ContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false,
  },
  github: {
    host: 'https://dev.reactome.org',
    contentService: 'https://dev.reactome.org/ContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    preferS3: true,
  },
  remote: {
    host: 'https://dev.reactome.org',
    contentService: 'https://dev.reactome.org/ContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false,
  },
} as const;

// Build-time environment selector. The `define` option in angular.json replaces
// this identifier with a string literal per build configuration, so it works in
// the browser and under SSR without needing a `process` shim. When a build
// configuration sets no define the identifier is absent, which is why this is
// read through `typeof` rather than directly.
declare const APP_ENV: string | undefined;

function buildTimeEnvName(): string | undefined {
  return typeof APP_ENV !== 'undefined' ? APP_ENV : undefined;
}

// Runtime override, for host pages that embed the pathway-browser element and
// need to choose an environment without rebuilding. Takes precedence over the
// build-time define.
function runtimeEnvName(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __APP_ENV?: string }).__APP_ENV || undefined;
}

export const SELECTED_ENV_NAME: string | undefined = runtimeEnvName() ?? buildTimeEnvName();

// Helper: pick environment at runtime (fallback to production)
export function getEnv(envName?: string) {
  if (!envName) return ENVIRONMENTS.production;
  const key = envName as EnvName;
  return ENVIRONMENTS[key] ?? ENVIRONMENTS.production;
}
