import { describe, expect, it } from 'vitest';
import {
  getProfile,
  resolveHost,
  RUNTIME_PROFILES,
  SITE_PROFILES,
  type ProfileName,
} from './environments';
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

  it("refuses a name that is only an object's inherited property", () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(() => getProfile(name), name).toThrow(/Unknown APP_ENV/);
    }
  });

  it('gives each deployment both halves: a backend and a UI', () => {
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      const host = profile.host;
      expect(
        host === 'origin' || host === 'script' || /^https?:\/\//.test(host),
        `${name}.host`
      ).toBe(true);
      expect(['main', 'curator'], `${name}.variant`).toContain(profile.variant);
    }
  });

  it('uses its own origin where the serving host proxies the services', () => {
    // beta and dev are served by hosts that reverse-proxy their own
    // /ContentService, and that local Tomcat answers endpoints the public one
    // does not -- the reaction-diagram exporter among them. Naming a host
    // instead sent beta to reactome.org, which 404s that endpoint, and reaction
    // pages stopped drawing.
    for (const name of ['production', 'beta', 'release', 'development'] as ProfileName[]) {
      expect(SITE_PROFILES[name].host, `${name}.host`).toBe('origin');
      expect(SITE_PROFILES[name].originFallback, `${name}.originFallback`).toMatch(/^https:\/\//);
    }
  });

  it('serves reactome.org from itself, naming no other deployment', () => {
    // specs/032 T034: reactome.org runs the site image behind its own nginx,
    // which serves every service the site calls. The row named beta while the
    // build was served from a static file host; served from reactome.org, that
    // would send the public site's every call to beta, and naming the release
    // server would send them to a release not yet out.
    const production = SITE_PROFILES.production;
    expect(production.host).toBe('origin');
    expect(production.originFallback).toBe('https://reactome.org');
    expect(new URL(production.versionFallback).origin).toBe('https://reactome.org');
    const text = JSON.stringify(production);
    for (const other of ['beta.', 'release.', 'dev.', 'newcurator.', 'localhost'])
      expect(text, `production names ${other}`).not.toContain(other);
    expect(production.gsaServer).toBe('production');
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
      const canonical =
        profile.host === 'origin' || profile.host === 'script'
          ? profile.originFallback
          : profile.host;
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
    // `production` is a build's as well as a runtime name (RUNTIME_PROFILES).
    const siteProfiles = Object.keys(SITE_PROFILES).filter(
      (name) =>
        !name.startsWith('embed-') &&
        (name === 'production' || !RUNTIME_PROFILES.includes(name as ProfileName))
    );
    expect(configurations).toEqual(siteProfiles.sort());
  });

  it('selects every profile from exactly one build, across the site and the embed', () => {
    // The embeddable diagram (spec 009) is a second project with profiles of
    // its own. What each build runs as is its APP_ENV define, so that is what
    // is counted: a profile no build names is unreachable, and one named twice
    // is two deployments sharing hosts by accident.
    type Configurations = Record<string, { define?: { APP_ENV?: string } }>;
    const named = [angularJson.projects.reactome, angularJson.projects['reactome-diagram-element']]
      .flatMap((project) =>
        Object.values<Configurations[string]>(project.architect.build.configurations)
      )
      .flatMap((configuration) => {
        const env = configuration.define?.APP_ENV;
        return env === undefined ? [] : [JSON.parse(env) as string];
      });
    // The rest are chosen when the site is served, and no build may also name
    // one of them -- but `production`, the bare build's and reactome.org's
    // image's, which is one deployment reached both ways (RUNTIME_PROFILES).
    const both = named.filter((name) => RUNTIME_PROFILES.includes(name as ProfileName));
    expect(both).toEqual(['production']);
    expect([...new Set([...named, ...RUNTIME_PROFILES])].sort()).toEqual(
      Object.keys(SITE_PROFILES).sort()
    );
    expect(named.length + RUNTIME_PROFILES.length - both.length).toBe(
      Object.keys(SITE_PROFILES).length
    );
  });

  it('serves the embed from whichever host serves its code', () => {
    // The site's image is beta's build, and it runs the release server too; the
    // embed's profiles once named their hosts, so the release server's copy drew
    // beta's diagrams (spec 009, T043). A partner's page is not the host either.
    // The e2e build too, so the e2e suite runs the way the served ones resolve.
    for (const name of ['embed-production', 'embed-beta'] as ProfileName[]) {
      expect(SITE_PROFILES[name].host, `${name}.host`).toBe('script');
      expect(SITE_PROFILES[name].originFallback, `${name}.originFallback`).toMatch(/^https:\/\//);
    }
    expect(SITE_PROFILES['embed-development'].host).toBe('script');
    const embed = SITE_PROFILES['embed-beta'];
    const partner = 'https://partner.example';
    for (const host of ['https://beta.reactome.org', 'https://release.reactome.org']) {
      expect(
        resolveHost(embed, { page: partner, script: `${host}/embed/diagram/v1/main.js` })
      ).toBe(host);
    }
    // Off the browser, or loaded from a file (the unit tests): its canonical host.
    expect(resolveHost(embed, {})).toBe('https://beta.reactome.org');
    expect(resolveHost(embed, { script: 'file:///x/main.js' })).toBe('https://beta.reactome.org');
    // The other kinds are as they were.
    expect(
      resolveHost(SITE_PROFILES.release, { page: partner, script: 'https://x.example/m.js' })
    ).toBe(partner);
    expect(resolveHost(SITE_PROFILES.release, {})).toBe('https://release.reactome.org');
    expect(resolveHost(SITE_PROFILES.production, {})).toBe('https://reactome.org');
  });

  it("writes no host into the embed's served builds", () => {
    // A deployUrl is written into the build: the embed's picture addresses named
    // it, so every host serving that build had them fetched from the one named
    // (spec 009, T043). Its code takes them from its own address instead.
    const build = angularJson.projects['reactome-diagram-element'].architect.build;
    const configurations: Record<string, { deployUrl?: string }> = build.configurations;
    expect(Object.keys(configurations)).toEqual(
      expect.arrayContaining(['production', 'beta', 'development'])
    );
    for (const [name, configuration] of Object.entries({
      options: build.options,
      ...configurations,
    }))
      expect(
        (configuration as { deployUrl?: string }).deployUrl,
        `${name}.deployUrl`
      ).toBeUndefined();
  });

  it('serves the release server as a deployment of its own, not as beta', () => {
    // Beta's row there would send the release host's visits to beta's numbers,
    // offer DeltaSignal with no backend behind it, and have ReactomeGSA deliver
    // results to beta's Analysis Service, which the release site does not read.
    const release = SITE_PROFILES.release;
    expect(RUNTIME_PROFILES).toContain('release');
    expect(release.gtagId).toBeUndefined();
    expect(release.deltaSignal).toBeUndefined();
    expect(release.gsaServer).toBe('release');
    expect(release.host).toBe('origin');
    expect(release.originFallback).toBe('https://release.reactome.org');
  });

  it('serves reactome.org as the deployment the bare build is for', () => {
    // The image's page names production at run time; a build with no name gets
    // the same row. Both are the public site, chosen the two ways.
    expect(RUNTIME_PROFILES).toContain('production');
    expect(getProfile(undefined)).toBe(SITE_PROFILES.production);
    const production = SITE_PROFILES.production;
    expect(production.variant).toBe('main');
    expect(production.deltaSignal).toBeUndefined();
    expect(production.searchAnswerEndpoint).toBeUndefined();
    expect(production.analysisSummaryEndpoint).toBeUndefined();
    expect(production.chatHandoffEndpoint).toBeUndefined();
  });

  it('offers DeltaSignal only where a DeltaSignal backend can be reached', () => {
    // /api is routed by proxy.conf.js under the dev server, and by beta's nginx
    // (deploy/nginx/common/routes.conf) to the DeltaSignal service on the same
    // host. A deployment that turned this on without either would offer a
    // button whose every call fails, so only those two may have it.
    const reachable = ['development', 'beta'];
    for (const [name, profile] of Object.entries(SITE_PROFILES)) {
      expect(profile.deltaSignal === true, `${name}.deltaSignal`).toBe(reachable.includes(name));
    }
  });

  it('leaves DeltaSignal off for a profile that does not mention it', () => {
    // Absent means off, so adding a deployment cannot switch a research feature
    // on by inheriting it.
    const silent = Object.values(SITE_PROFILES).filter((p) => p.deltaSignal === undefined);
    expect(silent.length, 'profiles that say nothing about it').toBeGreaterThan(0);
    for (const profile of silent) expect(profile.deltaSignal === true).toBe(false);
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
