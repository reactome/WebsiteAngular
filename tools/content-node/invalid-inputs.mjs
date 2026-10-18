/**
 * Requests that give a declared query parameter a value Java would not take
 * as written, for every GET endpoint with parameters: each must be answered
 * as Java answers it, before an answer's label can be trusted (spec 011
 * FR-008). Built from the parameter record and each endpoint's own sample,
 * so a new endpoint or parameter is covered without being listed here.
 *
 *   node tools/content-node/invalid-inputs.mjs        # prints one path per line
 *
 * `view` and `includeRef`, declared on every endpoint, are tried on a few
 * only: they are read by one shared writer, and the graph this runs against
 * is shared, so each run is kept to a few hundred requests.
 */
import { fileURLToPath } from 'node:url';
import { RECORD, declaredQuery } from './parameters.mjs';

const VALUES = {
  integer: ['abc', '-1', '0', '01', '+1', '99999999999', ''],
  boolean: ['on', 'TRUE', 'abc', ''],
  enum: ['xyz', ''],
  string: [''],
  array: [''],
};
const SHARED = new Set(['view', 'includeRef']);
const SHARED_ON = new Set([
  '/ContentService/data/query/{id}',
  '/ContentService/data/event/{id}/in-depth',
  '/ContentService/data/diseases',
]);

/** A sample URL for an endpoint, as routes.spec.ts builds one. */
function sampleOf(endpoint) {
  const [id, query] = (endpoint.sample ?? '').split('?');
  const path = (id ? endpoint.path.replace(/\{[^}]+\}/, id) : endpoint.path)
    .replace(/\/schema\/\{id\}/, '/schema/Pathway')
    .replace(/\{(id|diagram|pathwayId|instance)\}/g, 'R-HSA-109581')
    // Real objects, so a bad parameter is reached rather than a 404 first:
    // TP53's UniProt entry, and a physical entity the site itself asks for.
    .replace(/\{resource\}/g, 'UniProt')
    .replace(/\{identifier\}/g, 'P04637')
    .replace(/\{dbId\}/g, '50758');
  return [path, query];
}

export function invalidInputs(endpoints) {
  const paths = [];
  for (const endpoint of endpoints) {
    const entry = RECORD[endpoint.path];
    if (!entry || entry.cache) continue;
    const [path, query] = sampleOf(endpoint);
    const sample = new URLSearchParams(query ?? '');
    for (const parameter of declaredQuery(endpoint.path)) {
      if (SHARED.has(parameter.name) && !SHARED_ON.has(endpoint.path)) continue;
      const type = parameter.enum && parameter.type !== 'array' ? 'enum' : parameter.type;
      const name = encodeURIComponent(parameter.name);
      // The sample's other parameters kept; this one given the bad value
      // alone, not repeated, so the value is what is tried.
      const others = [...sample].filter(([other]) => other !== parameter.name);
      const kept = others
        .map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}&`)
        .join('');
      for (const value of VALUES[type] ?? [''])
        paths.push(`${path}?${kept}${name}=${encodeURIComponent(value)}`);
    }
  }
  return [...new Set(paths)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { endpoints } = await import('./service.mjs');
  for (const path of invalidInputs(endpoints.filter((e) => !e.method || e.method === 'GET')))
    console.log(path);
  process.exit(0);
}
