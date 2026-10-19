/**
 * After a release's purge of the edge cache, ask for the answers most pages
 * start from, once each, so the first readers find them cached (spec 011).
 * Run against the public site, so the edge -- not node -- is what fills:
 *
 *   node tools/content-node/warm.mjs https://<site>
 *
 * The list is built from the release itself: the species, each one's
 * top-level pathways, and each top-level human pathway's details and
 * ancestors, spelled exactly as the site asks for them (the edge keeps one
 * entry per URL as written). Sequential, with a pause between requests:
 * after a purge each one reaches the graph.
 *
 * Fails, naming them, if any answer is not a 200 labelled cacheable -- a
 * URL that is not would be warmed for nothing, and is worth knowing about.
 */
import { fileURLToPath } from 'node:url';

const CS = '/ContentService';
/** As the Pathway Browser's data state and the details panel ask. */
const ENHANCED = [
  'fetchIncomingRelationships=true&summariseReferenceEntity=true&includeDisease=true&includeRef=true&view=nested-aggregated',
  'fetchIncomingRelationships=true&summariseReferenceEntity=false&includeDisease=true&includeRef=true&view=nested-aggregated',
];
const ANCESTORS = 'includeRef=true&view=nested-aggregated';
const FIXED = [
  '/data/database/version',
  '/data/database/name',
  '/data/species/main',
  '/data/species/all',
  '/data/content/toc',
  '/data/content/doi',
  '/data/content/contributors',
  '/data/diseases',
  '/data/schema/model',
];

/**
 * The URLs to warm, in order. `getJson(path)` answers a content API path
 * with its parsed body: the species list, and each species' top pathways.
 */
export async function warmList(getJson) {
  const paths = FIXED.map((path) => CS + path);
  const species = await getJson(`${CS}/data/species/main`);
  for (const { taxId } of species) paths.push(`${CS}/data/pathways/top/${taxId}`);
  const human = await getJson(`${CS}/data/pathways/top/9606`);
  for (const { stId } of human) {
    for (const query of ENHANCED) paths.push(`${CS}/data/query/enhanced/v2/${stId}?${query}`);
    paths.push(`${CS}/data/event/${stId}/ancestors?${ANCESTORS}`);
  }
  return [...new Set(paths)];
}

/** Asks for each URL once; resolves to those not answered 200 and cacheable. */
export async function warm(origin, paths, { fetch = globalThis.fetch, pause = 250 } = {}) {
  const missed = [];
  for (const path of paths) {
    const response = await fetch(origin + path);
    await response.arrayBuffer();
    const rule = response.headers.get('x-cache-rule');
    if (response.status !== 200 || rule !== 'standard')
      missed.push(`${response.status} ${rule ?? '-'} ${path}`);
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return missed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = (process.argv[2] ?? '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(origin)) {
    console.error('usage: node tools/content-node/warm.mjs https://<site>');
    process.exit(2);
  }
  const getJson = async (path) => (await fetch(origin + path)).json();
  const paths = await warmList(getJson);
  console.log(`warming ${paths.length} URLs on ${origin}`);
  const missed = await warm(origin, paths);
  if (missed.length) {
    console.error(`${missed.length} not cacheable:\n  ${missed.join('\n  ')}`);
    process.exit(1);
  }
  console.log('all cacheable');
}
