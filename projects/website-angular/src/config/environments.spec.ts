import { describe, expect, it } from 'vitest';
import { getProfile, SITE_PROFILES, type ProfileName } from './environments';

// A build reaches its backend and picks its UI through this table. When the two
// were chosen separately, the curator site could only reach its own backend by
// editing the public site's entry -- and once someone did, beta.reactome.org
// served the curation database, draft pathways and all, with nothing to say so.
describe('site profiles', () => {
  it('returns the deployment a build asked for', () => {
    expect(getProfile('development')).toBe(SITE_PROFILES.development);
    expect(getProfile('curator')).toBe(SITE_PROFILES.curator);
  });

  it('treats no name as the public site', () => {
    // A bare `ng build` is for the public site, and that is the safe default to
    // be wrong about.
    expect(getProfile(undefined)).toBe(SITE_PROFILES.production);
    expect(getProfile('')).toBe(SITE_PROFILES.production);
  });

  it('refuses a name it does not know instead of guessing', () => {
    expect(() => getProfile('prod')).toThrow(/Unknown APP_ENV "prod"/);
    expect(() => getProfile('plant')).toThrow(/Known deployments/);
  });

  it('gives each deployment both halves: a backend and a UI', () => {
    // The point of the table. A profile that named only a backend would let the
    // two drift apart again.
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      expect(profile.host, `${name}.host`).toMatch(/^https?:\/\//);
      expect(profile.contentService, `${name}.contentService`).toMatch(/^https?:\/\//);
      expect(['main', 'curator'], `${name}.variant`).toContain(profile.variant);
    }
  });

  it('keeps the public deployments off the curator backend', () => {
    for (const name of ['production', 'development'] as ProfileName[]) {
      const profile = SITE_PROFILES[name];
      expect(profile.host, `${name}.host`).not.toContain('newcurator');
      expect(profile.contentService, `${name}.contentService`).not.toContain('newcurator');
      expect(profile.variant).toBe('main');
    }
  });

  it('never sends one deployment to another for a fallback', () => {
    // A fallback that names a different deployment reports someone else's
    // release as this one's. Each profile's fallbacks stay on its own host --
    // except curator-local, which has no released graph of its own and says so.
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      if (name === 'curator-local') continue;
      const origin = new URL(profile.host).origin;
      expect(new URL(profile.versionFallback).origin, `${name}.versionFallback`).toBe(origin);
    }
  });
});
