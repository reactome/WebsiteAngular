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
// DeltaSignal's own compose binds 8080, but so does the Tomcat on the Reactome
// dev host that serves ContentService and AnalysisService. Defaulting to 8080
// therefore sends /api/pathways, /api/parse and /api/solve to Tomcat, which
// answers 404 -- a real server denying a real request, which looks like a broken
// feature rather than an unconfigured one.
//
// 8090 is where DeltaSignal is published on the dev host; the container still
// listens on 8080 inside. Override DELTASIGNAL_BACKEND for anything else.
const deltaSignalBackend = process.env.DELTASIGNAL_BACKEND || 'http://localhost:8090';

const localService = (context) => [context, { target: backend, secure, changeOrigin: true }];

const personList = {
  target: process.env.CONTENT_NODE_TARGET || 'http://127.0.0.1:4400',
  secure: false,
  changeOrigin: true,
};

module.exports = {
  '/api': {
    target: deltaSignalBackend,
    secure: deltaSignalBackend.startsWith('https'),
    changeOrigin: true,
  },
  '/reactome': {
    target: 'https://download.reactome.org',
    secure: true,
    changeOrigin: true,
    pathRewrite: { '^/reactome': '' },
  },
  // The content endpoints served by the node port (tools/content-node), listed
  // **before** the general /ContentService rule because the first match wins and
  // the general one would swallow them. These are all three of Java's
  // /data/content/ endpoints.
  //
  // Byte-identical to Java except two declared differences: a subpathway's DOI,
  // which ContentPageManager discards by passing null into TocSubpathway, and
  // the order of the contributors array, which nobody reads because the page
  // sorts by name before rendering. The DOI one is why the contents page had 3
  // of production's 44 DOIs, and why this repo carries a client-side join
  // against /content/doi to work around it. The join comes out once this is
  // serving everywhere, not before -- it is what keeps those links visible today.
  //
  // Reversible by deleting these entries. The node service holds the lists in
  // memory and answers in ~4ms, the same as Java; see specs/006 D9.
  ...Object.fromEntries(
    [
      '/ContentService/data/content/toc',
      '/ContentService/data/content/doi',
      '/ContentService/data/content/contributors',
    ].map((context) => [
      context,
      {
        target: process.env.CONTENT_NODE_TARGET || 'http://127.0.0.1:4400',
        secure: false,
        changeOrigin: true,
      },
    ])
  ),
  // The person page's four lists. A path pattern rather than a prefix: these
  // take an id in the middle, and `/ContentService/data/person` would also
  // claim `/data/person/{id}` and `/publications`, which node does not serve.
  '/ContentService/data/person/*/authoredPathways': personList,
  '/ContentService/data/person/*/authoredReactions': personList,
  '/ContentService/data/person/*/reviewedPathways': personList,
  '/ContentService/data/person/*/reviewedReactions': personList,
  ...Object.fromEntries(
    ['/ContentService', '/AnalysisService', '/ExperimentDigester'].map(localService)
  ),
  // The headless render service (tools/render/service.mjs), which produces the
  // formats the Java exporters used to: GIF, PPTX and anything else a document
  // needs. It binds to loopback and is reached only through this proxy, so
  // whatever fronts the site decides who may commission a render -- a render
  // costs seconds, and crawlers hitting the old /ContentService/exporter/*
  // endpoints are what exhausted Tomcat's heap and took the origin down.
  // In compose the service is another container, so the target has to be its
  // service name; on the host it is loopback. Same shape as REACTOME_BACKEND.
  '/RenderService': {
    target: process.env.RENDER_TARGET || 'http://127.0.0.1:4310',
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/RenderService': '' },
  },
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
