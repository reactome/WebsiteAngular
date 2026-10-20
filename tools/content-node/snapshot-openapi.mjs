/**
 * Write openapi-snapshot.json: the parameters of every operation in Java's
 * published API description, which parameters.ts is checked against
 * (parameters.spec.ts). The record says which query parameters an endpoint
 * declares; a URL carrying any other is answered but never stored at the
 * edge (spec 011). A parameter the record invented, or one it missed, would
 * label a URL wrongly, so the record is held to Java's own list.
 *
 *   node tools/content-node/snapshot-openapi.mjs            # Java on :8080
 *   JAVA_CONTENT_SERVICE=http://host:port node tools/content-node/snapshot-openapi.mjs
 *
 * Kept: for each path and method, each parameter's name, where it goes, and
 * its type, default, allowed values and whether it is required -- what the
 * record's test reads. Dropped: descriptions, examples, response schemas and
 * the server URL, which change without changing what a URL may carry.
 * Sorted, so a run against the same Java writes the same bytes.
 *
 * WHEN TO RUN IT: when the deployed ContentService changes its endpoints or
 * their parameters. One request.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JAVA = process.env.JAVA_CONTENT_SERVICE || 'http://localhost:8080';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'openapi-snapshot.json');

/** One parameter as the record's test reads it; absent fields left out. */
export function parameterOf(parameter) {
  const schema = parameter.schema ?? {};
  const items = schema.items ?? {};
  const kept = {
    name: parameter.name,
    in: parameter.in,
    type: schema.type,
    format: schema.format,
    items: schema.type === 'array' ? items.type : undefined,
    default: schema.default,
    enum: schema.enum ?? (schema.type === 'array' ? items.enum : undefined),
    required: parameter.required || undefined,
  };
  return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined));
}

/** The whole description reduced to `{ path: { method: [parameter] } }`, sorted. */
export function snapshotOf(description) {
  const paths = {};
  for (const pathName of Object.keys(description.paths ?? {}).sort()) {
    const operations = {};
    for (const method of Object.keys(description.paths[pathName]).sort()) {
      const operation = description.paths[pathName][method];
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      operations[method] = (operation.parameters ?? [])
        .map(parameterOf)
        .sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`));
    }
    paths[pathName] = operations;
  }
  return { openapi: description.openapi, paths };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch(`${JAVA}/ContentService/v3/api-docs`);
  if (response.status !== 200) throw new Error(`api-docs: ${response.status}`);
  const snapshot = snapshotOf(await response.json());
  const operations = Object.values(snapshot.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0
  );
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`${OUT}: ${Object.keys(snapshot.paths).length} paths, ${operations} operations`);
}
