import { describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { REACTOME_GSA_CONFIG } from 'reactome-gsa-form';
import { SITE_PROFILES } from '../../../../../website-angular/src/config/environments';
import { provideGsaConfig } from './gsa-config';

// Which Reactome server ReactomeGSA hands its results to. It POSTs each result
// to that server's Analysis Service and returns the token the browser opens, so
// a result is only visible on a site that reads that Analysis Service. The
// profiles said so all along, but nothing read them: every deployment sent
// `production`, and beta -- which reads its own -- could open none of them.
const serverFor = (server: 'production' | 'dev' | 'release') =>
  Injector.create({ providers: [provideGsaConfig(server)] }).get(REACTOME_GSA_CONFIG)().server;

describe('the ReactomeGSA server a deployment asks for', () => {
  it('is the one its profile names', () => {
    expect(serverFor('dev')).toBe('dev');
    expect(serverFor('production')).toBe('production');
  });

  it("is dev for beta, whose Analysis Service is dev.reactome.org's", () => {
    // Also keeps beta's test runs off the production server.
    expect(SITE_PROFILES.beta.gsaServer).toBe('dev');
  });

  it('stays production for reactome.org', () => {
    expect(SITE_PROFILES.production.gsaServer).toBe('production');
  });
});
