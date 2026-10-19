/**
 * After a release's purge of the edge cache, ask for the answers most pages
 * start from, once each, so the first readers find them cached (spec 011).
 * Run against the public site, so the edge -- not node -- is what fills:
 *
 *   node tools/content-node/warm.mjs https://<site> <release>
 *
 * `<release>` is the release just published. Node holds a few answers in
 * memory until it restarts -- the release number, the contents and DOIs,
 * each species' top pathways -- and warming a node still holding the last
 * release's would keep those at the edge until the next purge, with every
 * diagram and figure address built from the old number. So nothing is
 * asked for unless the content API already reports `<release>`.
 *
 * The list is built from the release itself: the species, each one's
 * top-level pathways, and each top-level human pathway's details and
 * ancestors, spelled exactly as the site asks for them (the edge keeps one
 * entry per URL as written). The events hierarchy is left out: Java still
 * answers it, unlabelled, and the edge does not keep it. Sequential, paced,
 * and each request limited, since after a purge each one reaches the graph.
 *
 * Fails, naming them, if any answer is not a 200 labelled cacheable -- a
 * redirect included, which is never kept. What the edge itself said
 * (cf-cache-status) is counted alongside: the label says it may be kept;
 * only the edge says whether it was.
 */
import { fileURLToPath } from 'node:url';

const CS = '/ContentService';
/** As the Pathway Browser's data state and the details panel ask. */
export const ENHANCED = [
  'fetchIncomingRelationships=true&summariseReferenceEntity=true&includeDisease=true&includeRef=true&view=nested-aggregated',
  'fetchIncomingRelationships=true&summariseReferenceEntity=false&includeDisease=true&includeRef=true&view=nested-aggregated',
];
export const ANCESTORS = 'includeRef=true&view=nested-aggregated';
export const FIXED = [
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
const LIMIT_MS = 60_000;

/**
 * The URLs to warm, in order. `getJson(path)` answers a content API path
 * with its parsed body: the species list, and human's top pathways.
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

/**
 * Asks for each URL once, a failed or hung request recorded rather than
 * ending the run. Resolves to `{ missed, edge }`: the URLs not answered 200
 * and cacheable, and how many of each cf-cache-status the edge gave.
 */
export async function warm(origin, paths, { fetch = globalThis.fetch, pause = 250 } = {}) {
  const missed = [];
  const edge = {};
  for (const path of paths) {
    try {
      const response = await fetch(origin + path, {
        redirect: 'manual',
        signal: AbortSignal.timeout(LIMIT_MS),
      });
      await response.arrayBuffer();
      const rule = response.headers.get('x-cache-rule');
      const status = response.headers.get('cf-cache-status') ?? 'none';
      edge[status] = (edge[status] ?? 0) + 1;
      if (response.status !== 200 || rule !== 'standard')
        missed.push(`${response.status} ${rule ?? '-'} ${path}`);
    } catch (failure) {
      missed.push(`failed (${failure.name}) ${path}`);
    }
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return { missed, edge };
}

/** A content API answer's body, or an error that says which and why. */
function jsonFrom(origin, fetch = globalThis.fetch) {
  return async (path) => {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(LIMIT_MS) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${path}: ${response.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${path}: not JSON (${text.slice(0, 60)})`);
    }
  };
}

/** The command: exit 0 when all are cacheable, 1 when not, 2 when refused. */
export async function main(argv, { fetch = globalThis.fetch, log = console.log, pause } = {}) {
  const origin = (argv[0] ?? '').replace(/\/$/, '');
  const release = argv[1] ?? '';
  if (!/^https?:\/\//.test(origin) || !/^\d+$/.test(release)) {
    log('usage: node tools/content-node/warm.mjs https://<site> <release>');
    return 2;
  }
  const getJson = jsonFrom(origin, fetch);
  const serving = String(await getJson(`${CS}/data/database/version`));
  if (serving !== release) {
    log(
      `the content API reports release ${serving}, not ${release}: restart it on the new release first`
    );
    return 2;
  }
  const paths = await warmList(getJson);
  log(`warming ${paths.length} URLs on ${origin}`);
  const { missed, edge } = await warm(origin, paths, {
    fetch,
    ...(pause === undefined ? {} : { pause }),
  });
  log(
    `the edge said: ${Object.entries(edge)
      .map(([status, count]) => `${status} ${count}`)
      .join(', ')}`
  );
  if (missed.length) {
    log(`${missed.length} not cacheable:\n  ${missed.join('\n  ')}`);
    return 1;
  }
  log('all cacheable');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (failure) => {
      console.error(failure.message);
      process.exit(1);
    }
  );
}
