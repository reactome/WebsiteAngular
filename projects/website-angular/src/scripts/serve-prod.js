/**
 * Serves the production build with the same API proxying `ng serve` provides.
 *
 * beta.reactome.org used to serve `ng serve` output straight to the public
 * internet. That is ~143 unbundled ES modules and 13 MB per page load, which is
 * unnoticeable over loopback and unusable through a reverse proxy and CDN --
 * a homepage that took 2.5s locally took 160s on beta, and the Pathway Browser
 * frequently never finished at all. The production build is ~424 kB over about
 * a dozen requests, and is also what real users actually run.
 *
 * The proxy table is required from proxy.conf.js so it cannot drift from the
 * dev server's, and honours REACTOME_BACKEND the same way.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

const ROOT = path.resolve(__dirname, '../../../..');
// DIST_DIR exists so this can be tested against a directory a test controls.
// Unset -- which is every real deployment -- it is the build output as before.
const DIST = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.join(ROOT, 'dist/reactome/browser');
const PORT = Number(process.env.PORT) || 4200;
const HOST = process.env.HOST || '0.0.0.0';

const INDEX = path.join(DIST, 'index.html');

/**
 * Serving starts before the build exists.
 *
 * This runs alongside `ng build --watch`, so on a cold start the output
 * directory is empty for the minute or so the first build takes. Exiting then
 * would mean the container dies before it ever serves anything; instead wait,
 * and say so, since a silent wait looks identical to a hang.
 */
async function waitForBuild(timeoutMs = 15 * 60 * 1000) {
  if (fs.existsSync(INDEX)) return true;
  console.log(`Waiting for the production build to appear at ${DIST} ...`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (fs.existsSync(INDEX)) {
      console.log(`Build ready after ${Math.round((Date.now() - startedAt) / 1000)}s.`);
      return true;
    }
  }
  return false;
}

const app = express();
app.disable('x-powered-by');

// Same backends the dev server proxies, so relative /ContentService calls work
// exactly as they do in development.
const proxyConfig = require(path.join(ROOT, 'proxy.conf.js'));
for (const [context, options] of Object.entries(proxyConfig)) {
  // Selected with pathFilter rather than mounted with app.use(context, ...):
  // mounting makes Express strip the prefix before the proxy sees the request,
  // so /ContentService/data/... would reach the backend as /data/... and 404.
  app.use(
    createProxyMiddleware({
      pathFilter: `${context}/**`,
      target: options.target,
      changeOrigin: options.changeOrigin ?? true,
      secure: options.secure ?? true,
      pathRewrite: options.pathRewrite,
      on: {
        error: (err, _req, res) => {
          console.error(`[proxy] ${context}: ${err.message}`);
          if (res && 'writeHead' in res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Upstream unavailable');
          }
        },
      },
    })
  );
}

// Hashed build artefacts are immutable; index.html must never be cached or a
// redeploy leaves browsers pinned to chunks that no longer exist.
app.use(
  express.static(DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

/**
 * A page to show while a rebuild is in flight.
 *
 * `ng build --watch` empties and rewrites the output directory, so for the ten
 * to twenty seconds a build takes there is no index.html to send. Requests
 * landing in that window used to surface Express's ENOENT stack trace, which
 * reads like the site is broken rather than busy -- and someone reading it has
 * no way to tell those apart.
 *
 * 503 with Retry-After is the honest answer: the server is fine, the build is
 * not there yet. The page reloads itself so nobody has to sit and refresh.
 */
const REBUILDING = `<!doctype html><meta charset="utf-8"><title>Rebuilding…</title>
<meta http-equiv="refresh" content="4">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; display: grid; place-items: center;
         height: 100vh; margin: 0; color: #123; background: #eff9fd; }
  div { text-align: center; }
  p { color: #567; }
</style>
<div>
  <h1>Rebuilding</h1>
  <p>A new build is being written. This page will refresh itself.</p>
</div>`;

// Client-side routing: anything not matched above is an Angular route.
app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'), (error) => {
    if (!error || res.headersSent) return;
    if (error.code === 'ENOENT') {
      res.setHeader('Retry-After', '5');
      return res.status(503).type('html').send(REBUILDING);
    }
    res.status(500).type('text/plain').send('Could not read the build output');
  });
});

waitForBuild().then((ready) => {
  if (!ready) {
    console.error(`No production build appeared at ${DIST}. Giving up.`);
    process.exit(1);
  }
  app.listen(PORT, HOST, () => {
    console.log(`Serving production build from ${DIST}`);
    console.log(`  http://${HOST}:${PORT}/`);
  });
});
