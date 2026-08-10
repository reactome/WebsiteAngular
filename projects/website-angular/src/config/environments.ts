export type EnvName = 'development' | 'production' | 'local' | 'github' | 'remote';

export const ENVIRONMENTS: Record<EnvName, { host: string; s3: string; gsaServer: string; gtagId?: string; preferS3?: boolean }> = {
  development: {
    host: 'https://newcurator.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    gtagId: 'G-96F1EYHQR3',
    preferS3: false
  },
  production: {
    host: 'https://newcurator.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    gtagId: 'G-EDHZ92GXZP',
    preferS3: false
  },
  local: {
    host: 'https://newcurator.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false
  },
  github: {
    host: 'https://newcurator.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    preferS3: false
  },
  remote: {
    host: 'https://newcurator.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false
  }
} as const;

// Helper: pick environment at runtime (fallback to production)
export function getEnv(envName?: string) {
  if (!envName) return ENVIRONMENTS.production;
  const key = envName as EnvName;
  return ENVIRONMENTS[key] ?? ENVIRONMENTS.production;
}