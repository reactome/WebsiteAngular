import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_GSA_CONFIG, REACTOME_GSA_CONFIG, config } from 'reactome-gsa-form';
import { SITE_PROFILES } from '../../../../../website-angular/src/config/environments';
import { configureGsa, provideGsaServer } from './gsa-config';

// Which Reactome server ReactomeGSA hands a deployment's results to. It stores
// each result in that server's Analysis Service and returns the token the
// browser opens, so it must be the server the deployment reads. The profiles
// said so all along, but nothing read them: every deployment sent `production`,
// and beta -- which reads its own -- could open none of them.
describe('the ReactomeGSA server a deployment asks for', () => {
  afterEach(() => config.set(DEFAULT_GSA_CONFIG));

  it('is what the form reads, once configured', () => {
    configureGsa('dev');
    expect(TestBed.inject(REACTOME_GSA_CONFIG)().server).toBe('dev');
  });

  it('is configured when the route providing it is entered', () => {
    TestBed.configureTestingModule({ providers: [provideGsaServer('release')] });
    expect(TestBed.inject(REACTOME_GSA_CONFIG)().server).toBe('release');
  });

  it("is dev for beta, whose Analysis Service is dev.reactome.org's", () => {
    // Also keeps beta's test runs off the production server.
    expect(SITE_PROFILES.beta.gsaServer).toBe('dev');
  });

  it('stays production for reactome.org', () => {
    expect(SITE_PROFILES.production.gsaServer).toBe('production');
  });
});
