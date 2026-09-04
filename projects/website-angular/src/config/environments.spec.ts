import { describe, expect, it } from 'vitest';
import { getProfile, SITE_PROFILES, type ProfileName } from './environments';
import angularJson from '../../../../angular.json';

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
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      const host = profile.host;
      expect(host === 'origin' || /^https?:\/\//.test(host), `${name}.host`).toBe(true);
      expect(['main', 'curator'], `${name}.variant`).toContain(profile.variant);
    }
  });

  it('uses its own origin where the serving host proxies the services', () => {
    // beta and dev are served by hosts that reverse-proxy their own
    // /ContentService, and that local Tomcat answers endpoints the public one
    // does not -- the reaction-diagram exporter among them. Naming a host
    // instead sent beta to reactome.org, which 404s that endpoint, and reaction
    // pages stopped drawing.
    for (const name of ['beta', 'development'] as ProfileName[]) {
      expect(SITE_PROFILES[name].host, `${name}.host`).toBe('origin');
      expect(SITE_PROFILES[name].originFallback, `${name}.originFallback`).toMatch(/^https:\/\//);
    }
  });

  it('names a backend for the artifact that is served from a bucket', () => {
    // `production` is built by deploy.yml and synced to S3. Its origin is
    // download.reactome.org, which answers 403 for /ContentService -- so it is
    // the one deployment that cannot ask its own origin and must name a host
    // that actually serves the app's services.
    const host = SITE_PROFILES.production.host;
    expect(host, 'the published artifact names a host').not.toBe('origin');
    expect(host).toMatch(/^https:\/\//);
    expect(host, 'and not the bucket it is served from').not.toContain('download.reactome.org');
  });

  it('keeps the public deployments off the curator backend', () => {
    for (const name of ['production', 'development'] as ProfileName[]) {
      const profile = SITE_PROFILES[name];
      expect(JSON.stringify(profile), `${name}`).not.toContain('newcurator');
      expect(profile.variant).toBe('main');
    }
  });

  it('never sends one deployment to another for a fallback', () => {
    // A fallback naming a different deployment reports someone else's release as
    // this one's. For an origin-served site the canonical public host is its own
    // deployment, so that is what its fallback may name -- nothing else.
    // curator-local is the exception and says why in the profile.
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      if (name === 'curator-local') continue;
      const canonical = profile.host === 'origin' ? profile.originFallback : profile.host;
      expect(canonical, `${name} needs a canonical host`).toBeDefined();
      const own = new URL(canonical as string).origin;
      expect(new URL(profile.versionFallback).origin, `${name}.versionFallback`).toBe(own);
    }
  });

  it('has exactly one build configuration per deployment, and vice versa', () => {
    // The whole promise of the design: a name means a deployment. A
    // configuration with no profile would throw at startup; a profile with no
    // configuration is unreachable, which is what five of the old environment
    // files were.
    const configurations = Object.keys(
      angularJson.projects.reactome.architect.build.configurations
    ).sort();
    expect(configurations).toEqual(Object.keys(SITE_PROFILES).sort());
  });

  it('reports to Google only from the public site', () => {
    // Every other deployment names no property, so gtag is never loaded there and
    // nothing is sent. Pointing beta, dev or curation traffic at the public
    // property would inflate reactome.org's numbers with hits it never received,
    // and nobody reading them later could separate the two.
    expect(SITE_PROFILES.production.gtagId, 'the public site reports').toMatch(/^G-[A-Z0-9]+$/);
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      if (name === 'production') continue;
      expect(profile.gtagId, `${name} must not report to Google`).toBeUndefined();
    }
  });
});
