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

function solrConfigured() {
  return Boolean(envSetting('SOLR_URL') && envSetting('SOLR_USER') && envSetting('SOLR_PASSWORD'));
}

/**
 * Ask one of the core's request handlers, as SolrJ's POST does: the
 * parameters form-encoded, the answer as JSON. `params` is a list of
 * [name, value] pairs, since a name may repeat.
 */
export async function solr(handler, params) {
  if (!solrConfigured()) throw new Error('SOLR_URL, SOLR_USER and SOLR_PASSWORD are not set');
  const body = new URLSearchParams([['wt', 'json'], ...params]);
  const credentials = Buffer.from(
    `${envSetting('SOLR_USER')}:${envSetting('SOLR_PASSWORD')}`
  ).toString('base64');
  const response = await fetch(`${envSetting('SOLR_URL').replace(/\/$/, '')}${handler}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
    signal: AbortSignal.timeout(SOLR_TIMEOUT_MS),
  });
  if (!response.ok)
    throw Object.assign(new Error(`Solr answered ${response.status}`), { solr: true });
  return response.json();
}
