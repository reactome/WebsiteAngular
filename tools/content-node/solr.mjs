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
 * SOLR_PASSWORD come from the environment or the credentials file graph.mjs
 * reads, and nowhere else.
 */
import { URLSearchParams } from 'node:url';
import { envSetting } from './graph.mjs';

/** A read that runs past this is abandoned, as a graph read is at graph.mjs's. */
const SOLR_TIMEOUT_MS = 30_000;

/**
 * How many requests Solr is sent at once; the rest wait their turn. Java's
 * client is HttpClient's default, two connections to one host, and Solr's
 * heap is sized for that. The search box asks on every keystroke, and each
 * ask is one request plus one per collation: without this, a burst of typing
 * -- or a script -- reached Solr all at once. SOLR_CONCURRENCY, 1-16.
 */
function solrConcurrency() {
  const given = Number(envSetting('SOLR_CONCURRENCY', '2'));
  return Number.isInteger(given) && given >= 1 && given <= 16 ? given : 2;
}

/** Past this many waiting, a request is refused rather than queued. */
const MOST_WAITING = 64;

let open = 0;
const waiting = [];

async function turn() {
  if (open < solrConcurrency()) {
    open += 1;
    return;
  }
  if (waiting.length >= MOST_WAITING)
    throw Object.assign(new Error('Solr is busy'), { busy: true });
  await new Promise((resolve) => waiting.push(resolve));
}

function done() {
  const next = waiting.shift();
  if (next) next();
  else open -= 1;
}

/** Whether Solr can be asked: a URL, and with a user only with a password. */
export function solrConfigured() {
  return (
    Boolean(envSetting('SOLR_URL')) && !envSetting('SOLR_USER') === !envSetting('SOLR_PASSWORD')
  );
}

/**
 * The core's URL, refused when it carries credentials: fetch will not send
 * them, and its error repeats the URL, password and all, into the log.
 */
function coreUrl() {
  const given = envSetting('SOLR_URL');
  let url;
  try {
    url = new URL(given);
  } catch {
    throw new Error('SOLR_URL is not a URL');
  }
  if (url.username || url.password)
    throw new Error('SOLR_URL must not carry credentials: set SOLR_USER and SOLR_PASSWORD');
  return given.replace(/\/$/, '');
}

/**
 * Ask one of the core's request handlers, as SolrJ's POST does: the
 * parameters form-encoded, the answer as JSON with named lists flat -- the
 * layout collations() reads, pinned so a handler default cannot change it.
 * `params` is a list of [name, value] pairs, since a name may repeat. Basic
 * authentication when a user is set, as Java sends it only then.
 */
export async function solr(handler, params) {
  if (!solrConfigured()) throw new Error('SOLR_URL is not set, or SOLR_USER without SOLR_PASSWORD');
  const url = `${coreUrl()}${handler}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
  if (envSetting('SOLR_USER'))
    headers.Authorization = `Basic ${Buffer.from(
      `${envSetting('SOLR_USER')}:${envSetting('SOLR_PASSWORD')}`
    ).toString('base64')}`;
  await turn();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams([['wt', 'json'], ['json.nl', 'flat'], ...params]),
      signal: AbortSignal.timeout(SOLR_TIMEOUT_MS),
    });
    if (!response.ok)
      throw Object.assign(new Error(`Solr answered ${response.status}`), { solr: true });
    return await response.json();
  } catch (failure) {
    throw Object.assign(failure, { solr: true });
  } finally {
    done();
  }
}
