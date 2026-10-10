/**
 * The help-desk route: what it refuses, and what it hands to the mailer.
 *
 * Nothing is ever sent: the mailer and the Turnstile check are stood in for,
 * and the keys are Cloudflare's published test keys. The gate reads its keys
 * at import, so they are set before the require below.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
process.env.TURNSTILE_SITEKEY = '1x00000000000000000000AA';

const require = createRequire(import.meta.url);
const express = require('express');
const { mountContactRoute, sendmail, __resetLimits } = require('./contact-route.js');

const CONFIGURED = { CONTACT_TO: 'desk@example.org', CONTACT_FROM: 'site@example.org' };
const GOOD = {
  mailAddress: 'reader@example.org',
  subject: 'No results found for xyzzy',
  message: 'Dear help desk,\n\nI searched for xyzzy.\n.\nA line with only a dot.',
  token: 'turnstile-token',
};

let server;
let base;
let sent;
let verified;
let verifyAnswer;
let sendFails;

async function start(env = CONFIGURED) {
  const app = express();
  mountContactRoute(app, {
    env,
    verify: async (token) => {
      verified.push(token);
      return verifyAnswer;
    },
    send: async (raw, from) => {
      if (sendFails) throw new Error('relay refused');
      sent.push({ raw, from });
    },
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/contact`;
}

const post = (body) =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  __resetLimits();
  sent = [];
  verified = [];
  verifyAnswer = true;
  sendFails = false;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('a deployment that can send', () => {
  beforeEach(() => start());

  it('gives the form its sitekey', async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sitekey: '1x00000000000000000000AA' });
  });

  it('checks the token, then hands on one message, answered to the reader', async () => {
    const response = await post(GOOD);
    expect(response.status).toBe(200);
    expect(verified).toEqual(['turnstile-token']);
    expect(sent).toHaveLength(1);
    const { raw, from } = sent[0];
    expect(from).toBe('site@example.org');
    expect(raw).toContain('To: desk@example.org\n');
    expect(raw).toContain('From: Reactome website <site@example.org>\n');
    expect(raw).toContain('Reply-To: reader@example.org\n');
    expect(raw).toContain('Subject: No results found for xyzzy\n');
    expect(raw).toContain('A line with only a dot.');
    expect(raw).toContain('by reader@example.org.');
  });

  it('signs the message with the name given, on one line', async () => {
    await post({ ...GOOD, contactName: 'Ada\r\nLovelace' });
    expect(sent[0].raw).toContain('by Ada Lovelace <reader@example.org>.');
  });

  it('sends nothing when the token is refused', async () => {
    verifyAnswer = false;
    expect((await post(GOOD)).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('refuses a message with no token without asking Cloudflare', async () => {
    expect((await post({ ...GOOD, token: '' })).status).toBe(400);
    expect(verified).toEqual([]);
  });

  it('refuses an address that would add a header', async () => {
    const response = await post({
      ...GOOD,
      mailAddress: 'reader@example.org\r\nBcc: x@example.org',
    });
    expect(response.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('keeps a subject on one line, so it cannot add a header', async () => {
    await post({ ...GOOD, subject: 'Hello\r\nBcc: x@example.org' });
    const headers = sent[0].raw.split('\n\n')[0].split('\n');
    expect(headers.some((line) => line.startsWith('Bcc:'))).toBe(false);
    expect(headers).toContain('Subject: Hello Bcc: x@example.org');
  });

  it('encodes a subject that is not plain ASCII', async () => {
    await post({ ...GOOD, subject: 'Résumé' });
    expect(sent[0].raw).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('Résumé').toString('base64')}?=\n`
    );
  });

  it('refuses an empty or oversized message', async () => {
    expect((await post({ ...GOOD, message: '  ' })).status).toBe(400);
    expect((await post({ ...GOOD, message: 'x'.repeat(10_001) })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('says so when the mail cannot be handed on', async () => {
    sendFails = true;
    expect((await post(GOOD)).status).toBe(502);
  });

  it('limits how many messages one address sends', async () => {
    for (let i = 0; i < 3; i++) expect((await post(GOOD)).status).toBe(200);
    const response = await post(GOOD);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(sent).toHaveLength(3);
  });
});

describe('a deployment with nowhere to send', () => {
  for (const [name, env] of [
    ['no recipient', { CONTACT_FROM: 'site@example.org' }],
    ['no sender', { CONTACT_TO: 'desk@example.org' }],
  ]) {
    it(`says it cannot send, with ${name}`, async () => {
      await start(env);
      expect((await fetch(base)).status).toBe(503);
      expect((await post(GOOD)).status).toBe(503);
      expect(verified).toEqual([]);
      expect(sent).toEqual([]);
    });
  }
});

describe('handing a message to sendmail', () => {
  // A stand-in for the binary that records what it was given and sends nothing.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactome-sendmail-'));
  const fake = (exitCode) => {
    const script = path.join(dir, `sendmail-${exitCode}`);
    fs.writeFileSync(
      script,
      `#!/bin/sh\necho "$@" > "${dir}/args"\ncat > "${dir}/stdin"\nexit ${exitCode}\n`,
      { mode: 0o755 }
    );
    return script;
  };

  it('reads recipients from the headers, keeps lone dots, and sets the sender', async () => {
    await sendmail('To: desk@example.org\n\n.\n', 'site@example.org', fake(0));
    expect(fs.readFileSync(path.join(dir, 'args'), 'utf8').trim()).toBe(
      '-t -i -f site@example.org'
    );
    expect(fs.readFileSync(path.join(dir, 'stdin'), 'utf8')).toBe('To: desk@example.org\n\n.\n');
  });

  it('fails when the MTA does', async () => {
    await expect(
      sendmail('To: desk@example.org\n\n', 'site@example.org', fake(75))
    ).rejects.toThrow(/exited 75/);
  });

  it('fails when there is no MTA', async () => {
    await expect(
      sendmail('To: desk@example.org\n\n', 'site@example.org', path.join(dir, 'missing'))
    ).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
