import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS, getEnv } from './environments';

// A build reaches its backend through this function. When it guessed, the
// consequence was not an error but a wrong answer delivered confidently:
// beta.reactome.org served the curation database, draft pathways and all, and
// only the pathway names gave it away.
describe('choosing an environment', () => {
  it('returns the entry a build asked for', () => {
    expect(getEnv('development')).toBe(ENVIRONMENTS.development);
    expect(getEnv('local')).toBe(ENVIRONMENTS.local);
  });

  it('treats no name as the public site, which is what most builds want', () => {
    // Only `local` and `development` define APP_ENV; production and the curator
    // configurations define none and are meant to land here.
    expect(getEnv(undefined)).toBe(ENVIRONMENTS.production);
    expect(getEnv('')).toBe(ENVIRONMENTS.production);
  });

  it('refuses a name it does not know instead of guessing', () => {
    // A typo in a define, or an entry renamed while a configuration still asks
    // for it. Falling back would point the build at the wrong backend silently.
    expect(() => getEnv('prod')).toThrow(/Unknown APP_ENV "prod"/);
    expect(() => getEnv('curator')).toThrow(/Known environments/);
  });

  it('keeps the curator host out of the map entirely', () => {
    // The curator site is a build variant with its own environment files. While
    // a curator host lived in here, `production` was the only lever that reached
    // it, and pulling that lever put curation data on the public beta.
    for (const [name, config] of Object.entries(ENVIRONMENTS)) {
      expect(config.host, `${name}.host`).not.toContain('newcurator');
      expect(config.contentService, `${name}.contentService`).not.toContain('newcurator');
    }
  });
});
