/**
 * The report service a search that finds nothing is reported to, as
 * search-core's SearchService.report does it: a POST to
 * {REPORT_URL}/report/search/{notfound|targets} carrying the release, the
 * visitor's address and agent as parameters and the terms as JSON, with
 * basic authentication. Reactome keeps these for aggregate statistics, as
 * it keeps the web server's logs.
 *
 * Fire and forget, as Java's report threads are: the search's answer never
 * waits on it, and a failure is logged -- with Java's codes, never the URL,
 * which carries the address -- and nothing more. Without REPORT_URL nothing
 * is sent.
 */
import { URLSearchParams } from 'node:url';
import { envSetting } from './graph.mjs';

const REPORT_TIMEOUT_MS = 30_000;

export function sendReport(mapping, info, body) {
  const base = envSetting('REPORT_URL');
  if (!base) return;
  const query = new URLSearchParams();
  query.set('releaseNumber', info.release ?? '');
  query.set('ip', info.ip ?? '');
  query.set('agent', info.agent ?? '');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (envSetting('REPORT_USER'))
    headers.Authorization = `Basic ${Buffer.from(
      `${envSetting('REPORT_USER')}:${envSetting('REPORT_PASSWORD')}`
    ).toString('base64')}`;
  fetch(`${base.replace(/\/$/, '')}/report/search/${mapping}?${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  })
    .then((response) => {
      if (response.status !== 200)
        console.error(`[REP001] The report service answered ${response.status}; no report made`);
    })
    .catch(() => console.error('[REP002] Report service is unavailable'));
}
