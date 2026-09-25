/**
 * "Continue in chat": what our server sends the chatbot, and what it passes back.
 *
 * The browser opens whatever path this returns, so the one thing that must
 * never happen is a path outside the guest chat reaching it. The rest is the
 * contract: a caller token signed here, the tier the reader saw, and upstream's
 * refusals passed through as themselves.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.ANSWER_IDENTITY_SECRET = 'test-identity-secret';
process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
process.env.TURNSTILE_SITEKEY = '1x00000000000000000000AA';
const keyFile = path.join(os.tmpdir(), `reactome-test-handoff-${process.pid}.pem`);
fs.writeFileSync(
  keyFile,
  crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
);
process.env.CALLER_TOKEN_KEY = keyFile;

const require = createRequire(import.meta.url);
const express = require('express');
const gate = require('./human-gate.js');
const { mountChatHandoffProxy } = require('./search-answer-proxy.js');

let site;
let chatbot;
let base;
let received;
let reply;

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

beforeEach(async () => {
  received = null;
  reply = {
    status: 200,
    body: { id: 'Ev3z3JDm', path: '/chat/guest/#handoff=Ev3z3JDm', expires_in: 900 },
  };
  const upstream = express();
  upstream.post('/handoff', express.json(), (req, res) => {
    received = req.body;
    res.status(reply.status).json(reply.body);
  });
  chatbot = await listen(upstream);
  process.env.HANDOFF_UPSTREAM = `http://127.0.0.1:${chatbot.address().port}/handoff`;

  const app = express();
  mountChatHandoffProxy(app);
  site = await listen(app);
  base = `http://127.0.0.1:${site.address().port}/chat-handoff`;
});

afterEach(async () => {
  await new Promise((resolve) => site.close(resolve));
  await new Promise((resolve) => chatbot.close(resolve));
});

afterAll(() => fs.rmSync(keyFile, { force: true }));

const fresh = () => `ra_human=${encodeURIComponent(gate.mintIdentity(Date.now() - 60_000))}`;
const post = (body, cookie) =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

describe('an analysis handoff', () => {
  const body = { kind: 'analysis', token: 'MjAyNjA5MTUxMjAwMDBfMQ==', disclosure: 'aggregate' };

  it('is minted with a caller token signed here and the tier the reader saw', async () => {
    const response = await post(body, fresh());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: '/chat/guest/#handoff=Ev3z3JDm',
      expires_in: 900,
    });
    expect(received).toMatchObject({
      kind: 'analysis',
      token: body.token,
      disclosure: 'aggregate',
    });
    expect(received.caller_token.split('.')).toHaveLength(3);
  });

  it('asks the reader to prove they are here, like the summary', async () => {
    const response = await post(body);
    expect(response.status).toBe(401);
    expect(received).toBeNull();
  });

  it('refuses a tier that is not one', async () => {
    expect((await post({ ...body, disclosure: 'everything' }, fresh())).status).toBe(400);
  });
});

describe('a search handoff', () => {
  it('needs only the answer id, and no presence claim', async () => {
    const response = await post({ kind: 'search', answer_id: 'Ev3z3JDmIIUF4gkKTfrn9VF83H' });
    expect(response.status).toBe(200);
    expect(received).toMatchObject({ kind: 'search', answer_id: 'Ev3z3JDmIIUF4gkKTfrn9VF83H' });
  });
});

describe('what comes back', () => {
  it("passes upstream's refusal through, reason and status", async () => {
    // The one expected after every chatbot deploy: its store is in memory.
    reply = { status: 404, body: { reason: 'no_summary' } };
    const response = await post({ kind: 'search', answer_id: 'Ev3z3JDmIIUF4gkKTfrn9VF83H' });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ reason: 'no_summary' });
  });

  it('never hands the browser a path outside the guest chat', async () => {
    for (const path of [
      'https://evil.example/',
      '/chat/guest/?handoff=x',
      '//evil.example/#handoff=x',
    ]) {
      reply = { status: 200, body: { id: 'x', path, expires_in: 900 } };
      const response = await post({ kind: 'search', answer_id: 'Ev3z3JDmIIUF4gkKTfrn9VF83H' });
      expect(response.status, path).toBe(502);
    }
  });

  it('rejects an unknown kind without calling upstream', async () => {
    expect((await post({ kind: 'everything' })).status).toBe(400);
    expect(received).toBeNull();
  });
});
