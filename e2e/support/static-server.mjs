/**
 * Static files with the cross-origin header Reactome serves the embed with, for
 * tests that must put a page and the embedded diagram on different origins.
 *
 *   node e2e/support/static-server.mjs <dir> <port>
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [dir, port] = process.argv.slice(2);
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
    const body = await readFile(file);
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
