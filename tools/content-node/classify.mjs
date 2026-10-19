/**
 * Which node endpoint a content API request reaches, and whether it is in
 * standard form there (spec 011): the site's own requests are classified
 * with this as the e2e suite runs (E2E_CACHE_AUDIT, e2e/support/backend.ts),
 * so the site does not land on the slow path without anyone seeing it.
 * The record lists the endpoints in the order Express routes them, so the
 * first match is the endpoint the request reaches.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECORD, standardForm } from './parameters.mjs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let patterns;
const PATTERNS = () =>
  (patterns ??= Object.keys(RECORD).map((endpoint) => [
    endpoint,
    new RegExp(
      `^${endpoint
        .split(/\{\w+\}/)
        .map(escape)
        .join('[^/]+')}/?$`
    ),
  ]));

/**
 * `{ endpoint, ok, rule }` for a GET or HEAD that node answers, or undefined
 * for anything else (a write, or a path Java still answers). `url` is
 * absolute or a path, with its query as sent.
 *
 * @param {string} method
 * @param {string} url
 * @returns {{ endpoint: string, ok: boolean, rule: string } | undefined}
 */
export function classify(method, url) {
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const at = url.indexOf('/ContentService/');
  if (at === -1) return undefined;
  const sent = url.slice(at);
  const path = sent.split('?')[0];
  const found = PATTERNS().find(([, pattern]) => pattern.test(path));
  if (!found) return undefined;
  // Java's own, which nginx keeps from node's /query/{id}/{attribute},
  // /query/{id}/stId and /query/{id}/normalPathway
  // (deploy/nginx/common/routes-core.conf): /query/abridged/{id} and
  // /query/{id}/more. No node route matches the rest of Java's /query.
  if (/^\/ContentService\/data\/query\/(abridged\/[^/]+|[^/]+\/more)\/?$/.test(path))
    return undefined;
  const form = standardForm(found[0], sent);
  return { endpoint: found[0], ok: form.ok, rule: form.ok ? 'standard' : form.rule };
}

/**
 * Run on the file E2E_CACHE_AUDIT wrote: the site's requests node answers,
 * how many are in standard form, and each one that is not, by its rule.
 *
 *   node tools/content-node/classify.mjs <audit file>
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
  const seen = new Map();
  for (const line of lines) {
    const { method, url, test } = JSON.parse(line);
    const found = classify(method, url);
    if (!found) continue;
    const at = url.indexOf('/ContentService/');
    const key = `${method} ${url.slice(at)}`;
    if (!seen.has(key)) seen.set(key, { ...found, test });
  }
  const standard = [...seen.values()].filter((found) => found.ok).length;
  console.log(`${seen.size} distinct node requests, ${standard} in standard form`);
  const byRule = new Map();
  for (const [key, found] of seen)
    if (!found.ok)
      byRule.set(found.rule, [...(byRule.get(found.rule) ?? []), `${key}  (${found.test})`]);
  for (const [rule, keys] of byRule)
    console.log(`\n${rule}: ${keys.length}\n  ${keys.join('\n  ')}`);
}
