/**
 * Reactome's Solr, for the node port of the content service's /search.
 *
 * search-core (the Java library ContentService searches with) does its work in
 * Solr's own request handlers -- /suggest, /spellcheck, /exists, /search and
 * the rest, configured in the core's solrconfig.xml -- and sends them a few
 * parameters by POST. This sends the same parameters to the same handlers, so
 * what is matched, ranked and cut is Solr's, as it is for Java.
 *
 * SOLR_URL (the core, e.g. http://localhost:8983/solr/reactome), SOLR_USER and
 * SOLR_PASSWORD come from the environment or the credentials file graph.ts
 * reads, and nowhere else.
 */
import { URLSearchParams } from 'node:url';
import { settings } from './settings.ts';

/**
 * A call that has not been answered this long after it was made -- waiting
 * its turn included -- is abandoned, as a graph read is at graph.ts's.
 */
const SOLR_TIMEOUT_MS = 30_000;

/**
 * How many requests Solr is sent at once; the rest wait their turn, as they
 * do behind Java's client, HttpClient's default of two connections to one
 * host. The search box asks on every keystroke, and each ask is one request
 * plus one per collation. SOLR_CONCURRENCY, 1-16, read once, at first use.
 */
let limit: number | undefined;
function solrConcurrency() {
  if (limit === undefined) {
    const given = Number(settings.solrConcurrency());
    limit = Number.isInteger(given) && given >= 1 && given <= 16 ? given : 2;
  }
  return limit;
}

/** Past this many waiting, a request is refused rather than queued. */
const MOST_WAITING = 64;

let open = 0;
const waiting: (() => void)[] = [];

/**
 * A slot, now or when one is free. A waiter whose `signal` aborts -- its
 * deadline passed, or its client went away -- leaves the queue, so Solr is
 * never asked on behalf of nobody.
 */
/**
 * The abort's own reason, passed on as it is (a TimeoutError's name is what
 * callers read); an AbortSignal's reason is an Error unless given otherwise.
 */
const reasonOf = (signal: AbortSignal) => signal.reason as Error;

function turn(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(reasonOf(signal));
  if (open < solrConcurrency()) {
    open += 1;
    return Promise.resolve();
  }
  if (waiting.length >= MOST_WAITING)
    return Promise.reject(Object.assign(new Error('Solr is busy'), { busy: true }));
  return new Promise<void>((resolve, reject) => {
    // Handed a slot by done(), which has already taken it off the queue.
    const enter = () => {
      signal.removeEventListener('abort', leave);
      resolve();
    };
    const leave = () => {
      // Always still queued -- enter() removes this listener as done()
      // dequeues it -- but a splice at -1 would drop someone else.
      const at = waiting.indexOf(enter);
      if (at > -1) waiting.splice(at, 1);
      reject(reasonOf(signal));
    };
    signal.addEventListener('abort', leave, { once: true });
    waiting.push(enter);
  });
}

/** How many calls are waiting for a slot: for the specs. */
export const queued = () => waiting.length;

function done() {
  const next = waiting.shift();
  if (next) next();
  else open -= 1;
}

/**
 * Whether Solr can be asked: a URL that is one and carries no credentials,
 * and a user only with a password.
 */
export function solrConfigured() {
  try {
    coreUrl();
  } catch {
    return false;
  }
  return !settings.solrUser() === !settings.solrPassword();
}

/**
 * The core's URL, refused when it carries credentials: fetch will not send
 * them, and its error repeats the URL, password and all, into the log.
 */
function coreUrl() {
  const given = settings.solrUrl();
  if (!given) throw new Error('SOLR_URL is not set');
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new Error('SOLR_URL is not a URL');
  }
  if (url.username || url.password)
    throw new Error('SOLR_URL must not carry credentials: set SOLR_USER and SOLR_PASSWORD');
  return given.replace(/\/$/, '');
}

/** One stored value; a multi-valued field holds a list of them. */
export type SolrValue = string | number | boolean | null;
/** A document as Solr returns it: the stored fields it has. */
export type SolrDoc = { [field: string]: SolrValue | SolrValue[] | undefined };
/** A facet field with json.nl=flat: name, count, name, count, ... */
type SolrFlat = (string | number | null)[];
/** One grouping of a grouped answer. */
export interface SolrGrouping {
  ngroups?: number | null;
  matches?: number;
  groups?: {
    groupValue?: string | null;
    doclist?: { docs?: SolrDoc[]; numFound?: number };
  }[];
}
/**
 * The parts of a handler's JSON answer this service reads. Which are there
 * depends on the handler; each reader checks for its own.
 */
export interface SolrAnswer {
  response?: { numFound?: number; start?: number; docs?: SolrDoc[] };
  facet_counts?: { facet_fields?: { [field: string]: SolrFlat | null } };
  grouped?: { [field: string]: SolrGrouping };
  /** Per document id, per field, the highlighted snippets. */
  highlighting?: { [id: string]: { [field: string]: string[] | undefined } | undefined };
  /** With json.nl=flat: 'collation', then a query or {collationQuery, ...}, repeated. */
  spellcheck?: { collations?: (string | { collationQuery?: string } | null)[] };
}

/**
 * Ask one of the core's request handlers, as SolrJ's POST does: the
 * parameters form-encoded, the answer as JSON with named lists flat -- the
 * layout collations() reads, pinned so a handler default cannot change it.
 * `params` is a list of [name, value] pairs, since a name may repeat. Basic
 * authentication when a user is set, as Java sends it only then.
 */
export async function solr(
  handler: string,
  params: [string, string][],
  {
    signal,
    core,
    method = 'POST',
  }: { signal?: AbortSignal | undefined; core?: string; method?: string } = {}
): Promise<SolrAnswer | null> {
  // Another core on the same Solr: search-core asks "target" for terms
  // Reactome could annotate.
  const base = core ? coreUrl().replace(/[^/]+$/, core) : coreUrl();
  const url = `${base}${handler}`;
  const form = new URLSearchParams([['wt', 'json'], ['json.nl', 'flat'], ...params]);
  if (!settings.solrUser() !== !settings.solrPassword())
    throw new Error('SOLR_USER and SOLR_PASSWORD are set together or not at all');
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  };
  if (settings.solrUser())
    headers['Authorization'] = `Basic ${Buffer.from(
      `${settings.solrUser()}:${settings.solrPassword()}`
    ).toString('base64')}`;
  const deadline = AbortSignal.timeout(SOLR_TIMEOUT_MS);
  const until = signal ? AbortSignal.any([deadline, signal]) : deadline;
  await turn(until);
  try {
    // SolrJ's query() is a GET where search-core does not ask for a POST.
    const response = await fetch(method === 'GET' ? `${url}?${form.toString()}` : url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: form }),
      signal: until,
    });
    if (!response.ok) {
      // Its body unread holds the connection until collected: one request
      // that Solr refuses (a query it cannot parse) is enough to ask it.
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`Solr answered ${response.status}`), { solr: true });
    }
    // What the handler sent (JSON's null too); the readers check each part they use.
    return (await response.json()) as SolrAnswer | null;
  } catch (failure) {
    throw Object.assign(failure as Error, { solr: true });
  } finally {
    done();
  }
}
