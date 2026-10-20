// @vitest-environment node
//
// A service starts when Node is started with it, whatever its file is called
// (spec 013). The test was `endsWith('service.mjs')`: renamed to `.ts`, the
// content service loaded, never listened and exited 0. Each is started here
// through a link of another name, with nothing it could reach: a credentials
// file that does not exist, closed ports for everything it calls, and a spy
// that fails the test on any request leaving this machine.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'started-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Loaded into each service before it starts: a request to anywhere but this
// machine is said on stderr and refused. The content service fetched the
// PSICQUIC registry from EBI as it started listening (review of #544).
const SPY = path.join(dir, 'no-outside.mjs');
writeFileSync(
  SPY,
  `const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    process.stderr.write('OUTSIDE ' + url.href + '\\n');
    return Promise.reject(new Error('refused by the test'));
  }
  return real(input, init);
};
`
);

/** The first line the service prints within the time, or what it said on stopping. */
function start(file, env) {
  const link = path.join(dir, `renamed-${path.basename(path.dirname(file))}.mjs`);
  symlinkSync(path.join(ROOT, file), link);
  const child = spawn(process.execPath, ['--import', SPY, link], {
    env: { ...process.env, ...env },
  });
  return new Promise((resolve) => {
    let out = '';
    let waiting = false;
    const done = (said) => {
      clearTimeout(timer);
      child.kill();
      resolve(said);
    };
    const timer = setTimeout(() => done(`nothing after 15 s: ${out}`), 15_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      // A moment after starting, for what it does once it listens.
      if (/listening|render service on/.test(out) && !waiting) {
        waiting = true;
        setTimeout(() => done(out), 1500);
      }
    });
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => done(`exited ${code}: ${out}`));
  });
}

/**
 * A port nothing listens on. Not 0: the services read it as unset and take
 * their defaults, which are the ports the running services use.
 */
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(String(port)));
    });
  });

const NOWHERE = {
  CONTENT_NODE_ENV_FILE: path.join(dir, 'absent.env'),
  NEO4J_URI: 'bolt://127.0.0.1:9',
  SOLR_URL: 'http://127.0.0.1:9',
  REPORT_URL: 'http://127.0.0.1:9',
  PSICQUIC_REGISTRY_URL: 'http://127.0.0.1:9/',
  EUROPE_PMC_URL: 'http://127.0.0.1:9/',
  RENDER_SERVICE_URL: 'http://127.0.0.1:9',
};

it('starts the content service under another file name', async () => {
  const said = await start('tools/content-node/service.mjs', {
    ...NOWHERE,
    CONTENT_NODE_HOST: '127.0.0.1',
    CONTENT_NODE_PORT: await freePort(),
  });
  expect(said).toMatch(/^content-node listening on/);
  expect(said).not.toMatch(/OUTSIDE/);
}, 30_000);

it('starts the render service under another file name', async () => {
  const said = await start('tools/render/service.ts', {
    RENDER_HOST: '127.0.0.1',
    RENDER_PORT: await freePort(),
    RENDER_CACHE: path.join(dir, 'cache'),
    RENDER_BASE: 'http://127.0.0.1:9',
  });
  expect(said).toMatch(/^render service on/);
  expect(said).not.toMatch(/OUTSIDE/);
}, 30_000);
