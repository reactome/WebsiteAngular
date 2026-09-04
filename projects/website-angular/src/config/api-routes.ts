import { getEnv, SELECTED_ENV_NAME } from './environments';

const env = getEnv(SELECTED_ENV_NAME);

export const API_ROUTES = {
  CONTENT_SERVICE: env.contentService,
  ANALYSIS_SERVICE: `${env.host}/AnalysisService`,
  EXPERIMENT_SERVICE: `${env.host}/experiment`,
  RESTFUL_API: `${env.host}/ReactomeRESTfulAPI`,
  DOWNLOAD: `${env.host}/download/current`,
  OVERLAYS: `${env.host}/overlays`,
  CONTENT_DETAIL: `${env.host}/content/detail`,
  CONTENT_QUERY: `${env.host}/content/query`,
} as const;
