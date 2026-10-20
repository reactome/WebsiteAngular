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
import { settings } from './settings.ts';

const REPORT_TIMEOUT_MS = 30_000;

/**
 * A parameter value as Apache's URIBuilder writes it (URLEncodedUtils'
 * form set): letters, digits and _ - . * as they are, space as '+', every
 * other byte of its UTF-8 escaped.
 */
const form = (text: string) =>
  encodeURIComponent(text)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** JSON as Jackson writes it: a control character's escape in upper case (\u001F). */
const jacksonJson = (value: unknown) =>
  JSON.stringify(value).replace(/(\\+)u00([0-9a-f]{2})/g, (match, slashes, hex) =>
    slashes.length % 2 ? `${slashes}u00${hex.toUpperCase()}` : match
  );

/**
 * The body as Java's `new StringEntity(json)` sends it: ISO-8859-1, every
 * character beyond it a '?' -- whatever the Content-type header says.
 */
function latin1(text: string) {
  const bytes: number[] = [];
  for (const char of text) {
    // A character of a string has a code point.
    const code = char.codePointAt(0) as number;
    bytes.push(code < 256 ? code : 0x3f);
  }
  return Buffer.from(bytes);
}

/**
 * A lone surrogate as Java's ends up: URIBuilder writes it %3F, and the body,
 * where Jackson writes it raw, '?' once StringEntity encodes it.
 */
const wellFormed = <T>(text: T): T =>
  (typeof text === 'string'
    ? text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '?')
    : text) as T;

/** Who asked, as SearchService's report has it (service.ts, reportInformation). */
export interface ReportInfo {
  release: string | null;
  ip: string;
  agent: string | null;
}

/** What a report names: a term, and where it was looked for. */
export interface ReportTerm {
  term: string;
  resource: unknown;
}

export function sendReport(mapping: string, info: ReportInfo, body: ReportTerm | ReportTerm[]) {
  // Never the search's failure, whatever goes wrong here.
  try {
    send(mapping, info, body);
  } catch {
    console.error('[REP003] An unexpected error has occurred when saving a report');
  }
}

function send(mapping: string, info: ReportInfo, body: ReportTerm | ReportTerm[]) {
  const base = settings.reportUrl();
  if (!base) return;
  // A null value is a name alone, as BasicNameValuePair writes it.
  const query = [
    ['releaseNumber', info.release],
    ['ip', info.ip],
    ['agent', info.agent],
  ]
    .map(([name, value]) =>
      value === null || value === undefined ? name : `${name}=${form(wellFormed(value))}`
    )
    .join('&');
  // Java's report.user and report.password default to "default". Java sends
  // them only when the service challenges; it does, so they go at once here.
  const user = settings.reportUser();
  const password = settings.reportPassword();
  fetch(`${base.replace(/\/$/, '')}/report/search/${mapping}?${query}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: latin1(
      jacksonJson(
        Array.isArray(body)
          ? body.map((entity) => ({
              term: wellFormed(entity.term),
              resource: wellFormed(entity.resource),
            }))
          : { term: wellFormed(body.term), resource: wellFormed(body.resource) }
      )
    ),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  })
    .then((response) => {
      if (response.status !== 200)
        console.error(`[REP001] The report service answered ${response.status}; no report made`);
    })
    .catch(() => console.error('[REP002] Report service is unavailable'));
}
