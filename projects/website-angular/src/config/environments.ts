export type EnvName = 'development' | 'production' | 'local' | 'github' | 'remote';

export const ENVIRONMENTS: Record<
  EnvName,
  { host: string; s3: string; gsaServer: string; gtagId?: string; preferS3?: boolean }
> = {
  development: {
    host: 'https://dev.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    gtagId: 'G-96F1EYHQR3',
    preferS3: false,
  },
  production: {
    host: 'https://reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    gtagId: 'G-EDHZ92GXZP',
    preferS3: true,
  },
  local: {
    host: 'http://localhost:4200',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false,
  },
  github: {
    host: '../..',
    s3: 'https://download.reactome.org',
    gsaServer: 'production',
    preferS3: true,
  },
  remote: {
    host: 'https://dev.reactome.org',
    s3: 'https://download.reactome.org',
    gsaServer: 'dev',
    preferS3: false,
  },
} as const;
