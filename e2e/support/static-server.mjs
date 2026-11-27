/**
 * Static files with the cross-origin header Reactome serves the embed with, for
 * tests that must put a page and the embedded diagram on different origins.
 *
 *   node e2e/support/static-server.mjs <dir> <port> [embed] [--backend=<origin>]
 *
 * With `embed`, an HTML page's default address for the embed (the partner-style
 * pages name http://localhost:4340/, e2e's default) is served as that address
 * instead, so a run serving the embed on a port of its own finds it.
 *
 * With `--backend`, the backend's paths (/ContentService/ and the like) are
 * passed to that origin, as a deployment serves its data beside the embed's
 * code: the embed asks the host its code came from (spec 009, T043). Replay
 * answers those requests in the browser before they get here; recording sends
 * them on, to the site's dev server and its proxy.
 */
import { createServer, request as forward } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { BACKEND } from './har-entry.mjs';

const args = process.argv.slice(2);
const backend = args.find((a) => a.startsWith('--backend='))?.slice('--backend='.length);
const [dir, port, embed] = args.filter((a) => !a.startsWith('--backend='));
const DEFAULT_EMBED = 'http://localhost:4340/';
const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  if (backend && BACKEND.test(req.url ?? '')) {
    const upstream = forward(
      new URL(req.url ?? '/', backend),
      { method: req.method, headers: { ...req.headers, host: new URL(backend).host } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, {
          ...answer.headers,
          'access-control-allow-origin': '*',
        });
        answer.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'access-control-allow-origin': '*' });
      res.end();
    });
    req.pipe(upstream);
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    ''
  );
  // The embed at the addresses serve-prod gives it: its own, and the old
  // widget's, which pages written for that widget still load.
  const served =
    path === '/DiagramJs/diagram/diagram.nocache.js'
      ? '/reactome-diagram.js'
      : path.replace(/^\/embed\/diagram\/v1\//, '/');
  const file = join(dir, served.endsWith('/') ? served + 'index.html' : served);
  try {
    const read = await readFile(file);
    const body =
      embed && extname(file) === '.html'
        ? read.toString('utf8').replaceAll(DEFAULT_EMBED, embed)
        : read;
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'access-control-allow-origin': '*' });
    res.end();
  }
}).listen(Number(port), () => console.log(`serving ${dir} on ${port}`));
