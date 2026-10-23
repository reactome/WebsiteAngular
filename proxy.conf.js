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

/**
 * The bare API roots are this site's API page, not the service's.
 *
 * Opened directly, `/ContentService/` reached Tomcat's legacy Swagger page,
 * wrapped in a copy of the old reactome.org header whose menu leads to pages
 * this site does not have. The site's own page shows the same spec (read from
 * `v3/api-docs`, which is still the service's) under the site header. Only the
 * roots: every path beneath them is the API itself and stays proxied.
 *
 * `bypass` is the dev server's (Vite) hook: returning a path serves the app
 * instead of proxying. serve-prod.js honours the same hook, so the two cannot
 * disagree.
 */
const API_PAGE = /^\/(ContentService|AnalysisService)\/?(\?.*)?$/;
const apiPage = (context) => [
  context,
  {
    target: backend,
    secure,
    changeOrigin: true,
    bypass: (req) => (API_PAGE.test(req.url ?? '') ? '/index.html' : undefined),
  },
];

/** The node content service (tools/content-node), for the paths it answers. */
const contentNode = {
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
  // A raw ';' anywhere in the path is node's 404, as in nginx
  // (deploy/nginx/common/routes-core.conf; spec 006 T008).
  '^/ContentService/[^?]*;': contentNode,
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
  // Anchored, not prefixes: a prefix context also took /data/content/tocx
  // and /data/content/toc/X1, which nginx leaves to Java.
  '^/ContentService/data/content/(toc|doi|contributors)/?(\\?|$)': contentNode,
  // The species lists, not a `/data/species` prefix: Java also serves
  // `/data/species/{taxId}` shapes that node does not, and a prefix would
  // claim them and 404 what currently works.
  '^/ContentService/data/species/(main|all)/?(\\?|$)': contentNode,
  // The species overview, the Voronoi map, and the old fireworks exporter's
  // URL, which node redirects to it (spec 006 T093).
  '^/ContentService/exporter/(voronoi|fireworks)/[^/?]+/?(\\?|$)': contentNode,
  // An object with everything around it, for the details panel and the
  // website's detail pages; a reference entity as a summary of its entities.
  '^/ContentService/data/query/enhanced/v2/[^/?]+/?(\\?|$)': contentNode,
  // An object with its neighbours and some of theirs (the older enhanced query).
  '^/ContentService/data/query/enhanced/[^/?]+/?(\\?|$)': contentNode,
  // An entity or an event and everything below it, for the object tree.
  '^/ContentService/data/(entity|event)/[^/?]+/in-depth/?(\\?|$)': contentNode,
  // An event's or entity's counterpart in another species: one id (GET), or
  // up to twenty (POST), for the species selector.
  '^/ContentService/data/(orthology/[^/?]+/species|orthologies/ids/species)/[^/?]+/?(\\?|$)':
    contentNode,
  // An accession's interactors (details, enhanced details, with entities), how
  // many it has, the pathways they are in, and the diagram's POSTs for many.
  // PSICQUIC queries, uploads and tokens stay with Java.
  '^/ContentService/interactors/static/(molecule/((enhanced/)?[^/?]+/details|[^/?]+/(withEntities|summary|pathways))|molecules/(details|summary))/?(\\?|$)':
    contentNode,
  // The PSICQUIC services interactors can be drawn from.
  '^/ContentService/interactors/psicquic/resources/?(\\?|$)': contentNode,
  // The search box's completions and its "did you mean", the facets of
  // everything and of a query, and the icon library (its facets, pages and
  // icons); every other /search endpoint is the pattern below.
  '^/ContentService/search/(suggest|spellcheck|facet|facet_query|icon/[^/?]+)/?(\\?|$)':
    contentNode,
  // Search within a diagram, where an object occurs in it, the summary of
  // both, flagging a term in a diagram or across the species overview, the
  // diagrams an entity is in, the species-wide search (/fireworks), and the
  // website's search (/query).
  '^/ContentService/search/(diagram/[^/?]+(/occurrences/[^/?]+|/flag)?|fireworks(/flag)?|pathways/of/[^/?]+|query(/paginated)?)/?(\\?|$)':
    contentNode,
  // The Pathway Browser's "cite this": a pathway's citation, a paper's by
  // PubMed id, and either to download. /citation/export/{id} and /download
  // stay with Java.
  '^/ContentService/citation/(pathway/[^/?]+|static/[^/?]+|export)/?(\\?|$)': contentNode,
  // What points at an object, for the website's detail pages.
  '^/ContentService/data/instance/[^/?]+/referrers/?(\\?|$)': contentNode,
  // A person, the publications they authored, the person page's four lists,
  // and any other attribute of them. A `^` regex, not a glob: the dev server
  // moves every glob key to the end of the table, after the general
  // /ContentService rule, and the first match wins -- so under `ng serve` the
  // four lists once went to Java (#318). A `^` key stays where it is written.
  // It is matched against the path and query, as Vite does; serve-prod.js
  // reads it the same way. Same pattern as nginx's.
  '^/ContentService/data/person/[^/?]+(/[^/?]+)?/?(\\?|$)': contentNode,
  // One object with everything it points to, in any of Java's views
  // (?view=, ?includeRef=). Only the plain path: /query/{id}/... and Java's
  // /query/enhanced|abridged/{id} are other endpoints.
  // Including POST /query/ids, a batch of objects by id, and its map form.
  '^/ContentService/data/query/[^/?]+/?(\\?|$)': contentNode,
  '^/ContentService/data/query/ids/map/?(\\?|$)': contentNode,
  // Every disease, whole and as a DOID list.
  '^/ContentService/data/diseases(/doid)?/?(\\?|$)': contentNode,
  // Any attribute of an object, as Java's /data/query/{id}/{attributeName}
  // writes it. `abridged` and `enhanced` are not ids, nor `more` an attribute:
  // Java's more specific /query/abridged/{id}, /query/enhanced/{id} and
  // /query/{id}/more take those paths.
  '^/ContentService/data/query/(?!(abridged|enhanced)/)[^/?]+/(?!more/?(\\?|$))[^/?]+/?(\\?|$)':
    contentNode,
  // Every route from an event up to a top-level pathway; the Pathway Browser
  // asks on every pathway it opens.
  '^/ContentService/data/event/[^/?]+/ancestors/?(\\?|$)': contentNode,
  // The lower-level pathways an entity takes part in, with or without a
  // species: the entity popup and the participating-pathways list. Of every
  // form of it too, and the diagrams either is drawn in.
  '^/ContentService/data/pathways/low/(diagram/)?entity/[^/?]+(/allForms)?/?(\\?|$)': contentNode,
  // An event as a schema.org Dataset, for search engines; the site never asks.
  '^/ContentService/data/discover/[^/?]+/?(\\?|$)': contentNode,
  // The reactions and pathways an identifier in an outside resource is in.
  '^/ContentService/data/mapping/[^/?]+/[^/?]+/(reactions|pathways)/?(\\?|$)': contentNode,
  // The reference entities and cross references an identifier names.
  '^/ContentService/references/mapping/[^/?]+(/xrefs)?/?(\\?|$)': contentNode,
  // Every event below a pathway, and one attribute of each.
  '^/ContentService/data/pathway/[^/?]+/containedEvents(/[^/?]+)?/?(\\?|$)': contentNode,
  // What a complex is made of, and the complexes an identifier is part of.
  '^/ContentService/data/(complex/[^/?]+/subunits|complexes/[^/?]+/[^/?]+)/?(\\?|$)': contentNode,
  // The reference entities behind an event's participants (the molecule list
  // and the IDG page), and the physical entities themselves.
  '^/ContentService/data/participants/[^/?]+/(referenceEntities|participatingPhysicalEntities)/?(\\?|$)':
    contentNode,
  // An event's participants with their reference entities: the molecule list.
  '^/ContentService/data/participants/[^/?]+/?(\\?|$)': contentNode,
  // The release number (asked on every page load) and the database name, and
  // a species' top-level pathways -- ported first and long byte-identical,
  // but never switched over.
  '^/ContentService/data/database/(version|name)/?(\\?|$)': contentNode,
  '^/ContentService/data/pathways/top/[^/?]+/?(\\?|$)': contentNode,
  // The other forms of a physical entity: the details panel and the popup.
  // What an entity or event is part of: the details page's table.
  '^/ContentService/data/entity/[^/?]+/(otherForms|componentOf)/?(\\?|$)': contentNode,
  // Every place an object appears in the Pathway Browser: the details page's
  // locations tree. Only this one of Java's /data/detail/{id}/... paths.
  '^/ContentService/data/detail/[^/?]+/locationsInPWB/?(\\?|$)': contentNode,
  // The schema browser: the class tree, and a class's count, one page of its
  // objects (simplified, whole, or a reference class's by identifier), its
  // attributes and its referrals.
  '^/ContentService/data/schema/model/?(\\?|$)': contentNode,
  '^/ContentService/data/schema/[^/?]+(/(count|min|attributes|referrals|reference))?/?(\\?|$)':
    contentNode,
  ...Object.fromEntries([
    apiPage('/ContentService'),
    apiPage('/AnalysisService'),
    localService('/ExperimentDigester'),
    // The per-event BioPAX download, the legacy RESTful service in the same
    // Tomcat, as beta's nginx routes it (dev.conf; spec 015, User Story 3):
    // Level 3 by dbId and nothing else. Anchored, as nginx's location is: a
    // plain prefix ending in '/' was a different match in ng serve (any
    // suffix) and in serve-prod (never), and both disagreed with nginx.
    localService('^/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/\\d+(\\?|$)'),
  ]),
  // The headless render service (tools/render/service.ts), which produces the
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
