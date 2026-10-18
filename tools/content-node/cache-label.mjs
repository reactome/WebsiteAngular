/**
 * The caching label on every answer under /ContentService (spec 011). The
 * edge -- Cloudflare -- does all the caching; this only says, per answer,
 * whether it may be stored. A standard-form GET or HEAD answered 200 is kept
 * at the edge until the release purge and an hour in a browser; anything
 * else is answered just the same and never stored, so the set of stored
 * URLs stays finite whatever is asked. A request carrying an analysis token
 * is one person's, and private.
 *
 * The rule that decided goes out beside it as X-Cache-Rule, so a label that
 * looks wrong can be read off the answer.
 */
import { RECORD, standardForm } from './parameters.mjs';

/** Kept by the edge until purged at the next release; an hour in a browser. */
export const CACHEABLE = 'public, max-age=3600, s-maxage=31536000';
const NOT_STORED = 'no-store';
const PRIVATE = 'private, no-store';

/** Whether the query, as sent, has a parameter named exactly `token`. */
function carriesToken(originalUrl) {
  const at = originalUrl.indexOf('?');
  if (at === -1) return false;
  return originalUrl
    .slice(at + 1)
    .split('&')
    .some((pair) => {
      const name = pair.split('=')[0];
      try {
        return decodeURIComponent(name.replace(/\+/g, ' ')) === 'token';
      } catch {
        return false;
      }
    });
}

/** The label of an answer that never reached an endpoint. */
export function defaultLabel(originalUrl) {
  return carriesToken(originalUrl)
    ? { cacheControl: PRIVATE, rule: 'token' }
    : { cacheControl: NOT_STORED, rule: 'default' };
}

/**
 * The label of an endpoint's answer: `endpoint` is its path in the record,
 * `originalUrl` the request exactly as sent, `status` the answer's.
 */
export function label({ method, endpoint, originalUrl, status }) {
  if (carriesToken(originalUrl)) return { cacheControl: PRIVATE, rule: 'token' };
  const cache = RECORD[endpoint]?.cache;
  if (cache === 'private') return { cacheControl: PRIVATE, rule: 'endpoint' };
  if (method !== 'GET' && method !== 'HEAD') return { cacheControl: NOT_STORED, rule: 'method' };
  if (status !== 200) return { cacheControl: NOT_STORED, rule: 'status' };
  if (cache === 'never') return { cacheControl: NOT_STORED, rule: 'endpoint' };
  const form = standardForm(endpoint, originalUrl);
  return form.ok
    ? { cacheControl: CACHEABLE, rule: 'standard' }
    : { cacheControl: NOT_STORED, rule: form.rule };
}

/** Puts a label on a response. */
export function setLabel(response, { cacheControl, rule }) {
  response.setHeader('Cache-Control', cacheControl);
  response.setHeader('X-Cache-Rule', rule);
}
