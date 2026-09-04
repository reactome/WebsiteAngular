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

  it('never asks another deployment for data, only for which release is current', () => {
    // The rule that matters: no deployment answers with another's data. A
    // fallback naming a different site would report someone else's release as
    // this one's, which is how the curation database came to be served from beta.
    //
    // One narrow exception, chosen deliberately. The curator host cannot report a
    // release number at all -- its GraphContentService 500s and it serves no
    // /ContentService -- and it needs one to key bucket paths for the assets it
    // does take from the release. reactome.org is the authority on which release
    // is current, and a release number is not another deployment's data.
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      const fallback = new URL(profile.versionFallback).origin;
      if (profile.variant === 'curator') {
        expect(fallback, `${name} may only ask the public site`).toBe('https://reactome.org');
        continue;
      }
      const canonical = profile.host === 'origin' ? profile.originFallback : profile.host;
      expect(canonical, `${name} needs a canonical host`).toBeDefined();
      expect(fallback, `${name}.versionFallback`).toBe(new URL(canonical as string).origin);
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

  it('takes assets from the bucket unless a deployment says otherwise', () => {
    // The bucket is the default and says nothing; only a deployment whose assets
    // are not in a release opts out. Curator's diagram JSON is derived from the
    // curation graph and is ahead of any release, so no bucket path holds it.
    //
    // The inverse of this was load-bearing and got it wrong once: with the old
    // `preferS3` flag the development profile carried `false`, assets resolved to
    // ${host}/download/current, and under `ng serve` that is localhost:4200,
    // which proxy.conf.js does not proxy. CI caught it as `#cytoscape canvas`
    // never appearing.
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      const expected = profile.variant === 'curator' ? true : undefined;
      expect(profile.assetsFromHost, `${name}.assetsFromHost`).toBe(expected);
    }
  });
});
