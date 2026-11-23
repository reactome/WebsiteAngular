// @vitest-environment node
//
// The gateway's reading of the site's human pass (spec 031, research R6) is a
// twin of human-gate.js's: these check the two agree on a cookie the site
// itself mints, and that the secret is read from its file and nothing else.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { humanPass, identitySecretOf } from './human-pass.ts';

const SECRET = "a test secret, not the site's";

describe("the site's human pass, read by the gateway", () => {
  /** human-gate.js, loaded with SECRET as the site's identity secret. */
  const siteGate = () => {
    vi.stubEnv('ANSWER_IDENTITY_SECRET', SECRET);
    const require = createRequire(import.meta.url);
    const path = require.resolve('../../projects/website-angular/src/scripts/human-gate.js');
    delete require.cache[path];
    return require(path) as {
      mintIdentity: (now?: number) => string;
      readIdentity: (value: string, now?: number) => string | null;
    };
  };
  afterAll(() => vi.unstubAllEnvs());

  it("takes a pass the site mints, as the site's own reading does", () => {
    const gate = siteGate();
    const now = Date.now();
    const value = gate.mintIdentity(now);
    expect(gate.readIdentity(value, now)).not.toBeNull();
    expect(humanPass(`ra_human=${value}`, SECRET, now)).toBe('valid');
    expect(humanPass(`a=b; ra_human=${value}; c=d`, SECRET, now)).toBe('valid');
  });

  it('refuses what the site refuses: another secret, an expired pass, none', () => {
    const gate = siteGate();
    const now = Date.now();
    const value = gate.mintIdentity(now);
    expect(humanPass(`ra_human=${value}`, 'another secret', now)).toBe('invalid');
    // twelve hours on, past its expiry
    const later = now + 12 * 3_600_000 + 1;
    expect(gate.readIdentity(value, later)).toBeNull();
    expect(humanPass(`ra_human=${value}`, SECRET, later)).toBe('invalid');
    expect(humanPass(undefined, SECRET, now)).toBe('missing');
    expect(humanPass('ra_humanx=1', SECRET, now)).toBe('missing');
    // a pass, but no secret to check it with
    expect(humanPass(`ra_human=${value}`, '', now)).toBe('invalid');
  });

  it("reads the secret from the environment, or that one line of the site's settings file", () => {
    const dir = mkdtempSync(join(tmpdir(), 'human-pass-'));
    try {
      const file = join(dir, 'answer.env');
      writeFileSync(file, `OTHER=1\nexport ANSWER_IDENTITY_SECRET="from the file"\nLAST=2\n`);
      expect(identitySecretOf({}, file)).toBe('from the file');
      expect(identitySecretOf({ ANSWER_IDENTITY_SECRET: 'from the env' }, file)).toBe(
        'from the env'
      );
      expect(identitySecretOf({}, join(dir, 'none.env'))).toBe('');
      writeFileSync(file, 'OTHER=1\n');
      expect(identitySecretOf({}, file)).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
