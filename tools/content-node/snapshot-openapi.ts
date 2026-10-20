/**
 * Write openapi-snapshot.json: the parameters of every operation in Java's
 * published API description, which parameters.ts is checked against
 * (parameters.spec.ts). The record says which query parameters an endpoint
 * declares; a URL carrying any other is answered but never stored at the
 * edge (spec 011). A parameter the record invented, or one it missed, would
 * label a URL wrongly, so the record is held to Java's own list.
 *
 *   node tools/content-node/snapshot-openapi.ts            # Java on :8080
 *   JAVA_CONTENT_SERVICE=http://host:port node tools/content-node/snapshot-openapi.ts
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

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'openapi-snapshot.json');

interface OpenApiSchema {
  type?: string;
  format?: string;
  default?: unknown;
  enum?: unknown[];
  items?: OpenApiSchema;
}
interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: OpenApiSchema;
}
/** The part of Java's API description read here; a path item also holds non-operations. */
interface OpenApiDescription {
  openapi: string;
  paths?: Record<string, Record<string, unknown>>;
}
/** One parameter as kept: name and place always, the rest when Java gives them. */
export type SnapshotParameter = { name: string; in: string } & Record<string, unknown>;
export interface OpenApiSnapshot {
  openapi: string;
  paths: Record<string, Record<string, SnapshotParameter[]>>;
}

/** One parameter as the record's test reads it; absent fields left out. */
export function parameterOf(parameter: OpenApiParameter): SnapshotParameter {
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
  return Object.fromEntries(
    Object.entries(kept).filter(([, value]) => value !== undefined)
  ) as SnapshotParameter;
}

/** The whole description reduced to `{ path: { method: [parameter] } }`, sorted. */
export function snapshotOf(description: OpenApiDescription): OpenApiSnapshot {
  const paths: OpenApiSnapshot['paths'] = {};
  for (const [pathName, item] of Object.entries(description.paths ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const operations: Record<string, SnapshotParameter[]> = {};
    for (const method of Object.keys(item).sort()) {
      const operation = item[method];
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      const { parameters } = operation as { parameters?: OpenApiParameter[] };
      operations[method] = (parameters ?? [])
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
  const snapshot = snapshotOf((await response.json()) as OpenApiDescription);
  const operations = Object.values(snapshot.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0
  );
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`${OUT}: ${Object.keys(snapshot.paths).length} paths, ${operations} operations`);
}
