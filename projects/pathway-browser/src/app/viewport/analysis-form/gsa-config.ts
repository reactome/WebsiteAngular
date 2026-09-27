import { signal, type Provider } from '@angular/core';
import { DEFAULT_GSA_CONFIG, REACTOME_GSA_CONFIG, type GsaConfig } from 'reactome-gsa-form';

/**
 * The ReactomeGSA settings this deployment runs with.
 *
 * `server` is where ReactomeGSA delivers results: it POSTs each one to that
 * server's `/AnalysisService/import/form` and hands back the token, so only a
 * site reading that Analysis Service can open it. Without this provider the
 * form used its library default, `production`, on every deployment.
 */
export function provideGsaConfig(server: GsaConfig['server']): Provider {
  return {
    provide: REACTOME_GSA_CONFIG,
    useValue: signal<GsaConfig>({ ...DEFAULT_GSA_CONFIG, server }),
  };
}
