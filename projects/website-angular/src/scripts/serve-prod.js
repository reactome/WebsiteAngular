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
 * The proxy table is read from proxy.conf.json so it cannot drift from the dev
 * server's.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

const ROOT = path.resolve(__dirname, '../../../..');
const DIST = path.join(ROOT, 'dist/reactome/browser');
const PORT = Number(process.env.PORT) || 4200;
const HOST = process.env.HOST || '0.0.0.0';

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No production build at ${DIST}.\nRun: npx ng build reactome --configuration production`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// Same backends the dev server proxies, so relative /ContentService calls work
// exactly as they do in development.
const proxyConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'proxy.conf.json'), 'utf8'));
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

// Client-side routing: anything not matched above is an Angular route.
app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Serving production build from ${DIST}`);
  console.log(`  http://${HOST}:${PORT}/`);
});
