import { provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';
import { config, DEFAULT_GSA_CONFIG, type GsaConfig } from 'reactome-gsa-form';

/**
 * Tells the ReactomeGSA form which Reactome server to name.
 *
 * `server` is where ReactomeGSA delivers results: it stores each one in that
 * server's Analysis Service and hands back the token, so only a site reading
 * that Analysis Service can open it. Without this the form used its library
 * default, `production`, on every deployment.
 *
 * Sets the library's own configuration (what `REACTOME_GSA_CONFIG` resolves
 * to), and is provided on the Pathway Browser's route rather than the root: the
 * form is only reachable there, and importing the library at the root pulled
 * all of it into the initial bundle.
 */
export function configureGsa(server: GsaConfig['server']): void {
  config.set({ ...DEFAULT_GSA_CONFIG, server });
}

export function provideGsaServer(server: GsaConfig['server']): EnvironmentProviders {
  return provideEnvironmentInitializer(() => configureGsa(server));
}
