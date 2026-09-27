import { describe, expect, it } from 'vitest';
import { SITE_PROFILES } from '../../../../../website-angular/src/config/environments';

// Which Reactome server ReactomeGSA hands a deployment's results to. It stores
// each result in that server's Analysis Service and returns the token the
// browser opens, so it must be the server the deployment reads.
//
// That the form actually sends this value is proven end to end, where the
// submission is captured (e2e/analysis.spec.ts, "asks ReactomeGSA to deliver to
// this deployment's server"). Not here: the provider imports reactome-gsa-form,
// which CI does not build before `npm test`, and whose components this setup
// cannot compile.
describe('the ReactomeGSA server each deployment names', () => {
  it("is dev for beta, whose Analysis Service is dev.reactome.org's", () => {
    // Also keeps beta's test runs off the production server.
    expect(SITE_PROFILES.beta.gsaServer).toBe('dev');
  });

  it('stays production for reactome.org', () => {
    expect(SITE_PROFILES.production.gsaServer).toBe('production');
  });
});
