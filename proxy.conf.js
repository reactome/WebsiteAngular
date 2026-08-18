/**
 * Dev-server proxy table.
 *
 * This is JS rather than JSON so the backend can be chosen per environment.
 * On the Reactome dev host the whole stack -- ContentService, AnalysisService,
 * ExperimentDigester, and behind them Neo4j and Solr -- runs locally on :8080,
 * and pointing at it directly answers in ~2ms. Going out to dev.reactome.org
 * instead sends every API call through Cloudflare and back into the same
 * machine's Apache, which is both ~17s slower and how a repeated e2e run once
 * exhausted Apache's workers and took the origin down with 522s.
 *
 * CI has no local backend, so it sets REACTOME_BACKEND to a public host.
 */
const backend = process.env.REACTOME_BACKEND || 'http://localhost:8080';
const secure = backend.startsWith('https');

const localService = (context) => [context, { target: backend, secure, changeOrigin: true }];

module.exports = {
  '/reactome': {
    target: 'https://download.reactome.org',
    secure: true,
    changeOrigin: true,
    pathRewrite: { '^/reactome': '' },
  },
  ...Object.fromEntries(
    ['/ContentService', '/AnalysisService', '/ExperimentDigester'].map(localService)
  ),
  // GSAServer is not part of the local Tomcat deployment, so it always goes out
  // -- but to the GSA service itself, not via dev.reactome.org. That host
  // resolves back through this machine's Apache, which is the same hairpin that
  // took the origin down once before; with the box under load it simply stopped
  // answering, and every quantitative-analysis test failed with an empty
  // methods list. gsa.reactome.org answers the same request in ~0.2s.
  '/GSAServer': {
    target: 'https://gsa.reactome.org',
    secure: true,
    changeOrigin: true,
    pathRewrite: { '^/GSAServer': '' },
  },
};
