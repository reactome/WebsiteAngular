import { APP_BASE_HREF } from '@angular/common';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');
  const angularApp = new AngularNodeAppEngine();

  /**
   * Example Express Rest API endpoints can be defined here.
   * Uncomment and define endpoints as necessary.
   *
   * Example:
   * ```ts
   * server.get('/api/**', (req, res) => {
   *   // Handle API request
   * });
   * ```
   */

  /**
   * Serve static files from /browser
   */
  server.use(express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
  }));

  /**
   * Handle all other requests by rendering the Angular application.
   */
  server.use('*', (req, res, next) => {
    angularApp
      .handle(req)
      .then((response) => {
        if (response) {
          writeResponseToNodeResponse(response, res);
        } else {
          res.status(404).send('Not found');
        }
      })
      .catch(next);
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;

  // Start up the Node server
  const server = app();
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

if (isMainModule(import.meta.url)) {
  run();
}
