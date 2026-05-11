import { ENVIRONMENTS } from '../../../website-angular/src/config/environments';

const env = ENVIRONMENTS.development;

export const environment = {
  production: true,
  host: env.host,
  s3: env.s3,
  gsaServer: env.gsaServer,
  gtagId: env.gtagId,
  preferS3: env.preferS3
};

export const CONTENT_SERVICE = `http://localhost:8686/data`;
export const ANALYSIS_SERVICE = `${environment.host}/AnalysisService`;
export const EXPERIMENT_SERVICE = `${environment.host}/experiment`;
export const RESTFUL_API = `${environment.host}/ReactomeRESTfulAPI/RESTfulWS`;
export const DOWNLOAD = `${environment.host}/download/current`;
export const OVERLAYS = `${environment.host}/overlays`;
export const CONTENT_DETAIL = `${environment.host}/content/detail`;
export const CONTENT_QUERY = `${environment.host}/content/query`;
