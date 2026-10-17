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
import { envSetting } from './graph.mjs';

const REPORT_TIMEOUT_MS = 30_000;

/** application/x-www-form-urlencoded, as Apache's URIBuilder writes a parameter. */
const form = (text) =>
  encodeURIComponent(text)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The body as Java's `new StringEntity(json)` sends it: ISO-8859-1, every
 * character beyond it a '?' -- whatever the Content-type header says.
 */
function latin1(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    bytes.push(code < 256 ? code : 0x3f);
  }
  return Buffer.from(bytes);
}

export function sendReport(mapping, info, body) {
  const base = envSetting('REPORT_URL');
  if (!base) return;
  // A null value is a name alone, as BasicNameValuePair writes it.
  const query = [
    ['releaseNumber', info.release],
    ['ip', info.ip],
    ['agent', info.agent],
  ]
    .map(([name, value]) =>
      value === null || value === undefined ? name : `${name}=${form(value)}`
    )
    .join('&');
  // Java's report.user and report.password default to "default".
  const user = envSetting('REPORT_USER', 'default');
  const password = envSetting('REPORT_PASSWORD', 'default');
  fetch(`${base.replace(/\/$/, '')}/report/search/${mapping}?${query}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: latin1(JSON.stringify(body)),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  })
    .then((response) => {
      if (response.status !== 200)
        console.error(`[REP001] The report service answered ${response.status}; no report made`);
    })
    .catch(() => console.error('[REP002] Report service is unavailable'));
}
