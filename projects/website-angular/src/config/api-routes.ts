import { getEnv } from './environments';

const env = getEnv(process.env['APP_ENV'] || (typeof window !== 'undefined' && (window as any).__APP_ENV) || undefined);

export const API_ROUTES = {
  CONTENT_SERVICE: `http://localhost:8686/data`,
  ANALYSIS_SERVICE: `${env.host}/AnalysisService`,
  EXPERIMENT_SERVICE: `${env.host}/experiment`,
  RESTFUL_API: `http://localhost:8686`,
  DOWNLOAD: `${env.host}/download/current`,
  OVERLAYS: `${env.host}/overlays`,
  CONTENT_DETAIL: `${env.host}/content/detail`,
  CONTENT_QUERY: `${env.host}/content/query`
} as const;