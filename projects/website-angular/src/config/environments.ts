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

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  development: {
    host: 'https://newcurator.reactome.org',
    contentService: 'https://newcurator.reactome.org/GraphContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    gtagId: 'G-96F1EYHQR3',
    preferS3: false
  },
  production: {
    host: 'https://newcurator.reactome.org',
    contentService: 'https://newcurator.reactome.org/GraphContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    gtagId: 'G-EDHZ92GXZP',
    preferS3: false
  },
  local: {
    // Only the content service moves to the locally run curator-service; the
    // analysis service, downloads, overlays and detail pages have no local
    // equivalent, so they stay pointed at the curator host.
    host: 'https://newcurator.reactome.org',
    contentService: 'http://localhost:8686',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false
  },
  github: {
    host: 'https://newcurator.reactome.org',
    contentService: 'https://newcurator.reactome.org/GraphContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    preferS3: false
  },
  remote: {
    host: 'https://newcurator.reactome.org',
    contentService: 'https://newcurator.reactome.org/GraphContentService',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false
  }
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
  return (typeof window !== 'undefined' && (window as any).__APP_ENV) || undefined;
}

export const SELECTED_ENV_NAME: string | undefined =
  runtimeEnvName() ?? buildTimeEnvName();

// Helper: pick environment at runtime (fallback to production)
export function getEnv(envName?: string) {
  if (!envName) return ENVIRONMENTS.production;
  const key = envName as EnvName;
  return ENVIRONMENTS[key] ?? ENVIRONMENTS.production;
}
