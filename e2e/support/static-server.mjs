/**
 * Static files with the cross-origin header Reactome serves the embed with, for
 * tests that must put a page and the embedded diagram on different origins.
 *
 *   node e2e/support/static-server.mjs <dir> <port> [embed]
 *
 * With `embed`, an HTML page's default address for the embed (the partner-style
 * pages name http://localhost:4340/, e2e's default) is served as that address
 * instead, so a run serving the embed on a port of its own finds it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [dir, port, embed] = process.argv.slice(2);
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
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    ''
  );
  const file = join(dir, path.endsWith('/') ? path + 'index.html' : path);
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
