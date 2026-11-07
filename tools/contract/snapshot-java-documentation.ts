/**
 * Write java-documentation.json: what Java's published API description says
 * about each operation, for the description the content service publishes
 * (spec 016, T028). The contract describes the answers; Java's description
 * still holds the rest -- each operation's group, summary, notes,
 * operationId, parameters and request body, and what each error status means
 * -- and generate.ts merges the two.
 *
 *   node tools/contract/snapshot-java-documentation.ts            # Java on :8080
 *   JAVA_CONTENT_SERVICE=http://host:port node tools/contract/snapshot-java-documentation.ts
 *
 * Kept: the description's info and tags, and for each operation everything
 * but its answers' schemas (each status keeps its meaning and media types).
 * Dropped: the schemas (Java's are a generic object for most answers, which
 * the contract replaces), the components they refer to, and the server URL.
 * Sorted, so a run against the same Java writes the same bytes.
 *
 * WHEN TO RUN IT: when the deployed ContentService changes what it documents.
 * One request.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
export const DOCUMENTATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'java-documentation.json'
);

/** An answer of one status: what it means, and the media types it comes as. */
interface DocumentedResponse {
  description: string;
  mediaTypes?: string[];
}

/** One operation as Java documents it, its answers' schemas left out. */
export interface DocumentedOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, DocumentedResponse>;
}

/** java-documentation.json. */
export interface JavaDocumentation {
  info: Record<string, unknown>;
  tags: { name: string; description?: string }[];
  /** By Java's path (without /ContentService) and lower-case method. */
  paths: Record<string, Record<string, DocumentedOperation>>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keys sorted at every depth, so the file is the same for the same input. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])])
  );
}

/** An operation of Java's description, as kept. */
function operation(raw: Record<string, unknown>): DocumentedOperation {
  const { responses, ...rest } = raw;
  const kept: Record<string, DocumentedResponse> = {};
  for (const [status, answer] of Object.entries(isObject(responses) ? responses : {})) {
    if (!isObject(answer)) continue;
    const content = isObject(answer['content']) ? Object.keys(answer['content']).sort() : [];
    kept[status] = {
      description: typeof answer['description'] === 'string' ? answer['description'] : '',
      ...(content.length ? { mediaTypes: content } : {}),
    };
  }
  return { ...rest, responses: kept };
}

/** Java's description, as kept. */
export function documentation(raw: unknown): JavaDocumentation {
  if (!isObject(raw) || !isObject(raw['paths'])) throw new Error('not an OpenAPI description');
  const paths: JavaDocumentation['paths'] = {};
  for (const [where, methods] of Object.entries(raw['paths'])) {
    if (!isObject(methods)) continue;
    for (const [method, op] of Object.entries(methods))
      if (isObject(op)) (paths[where] ??= {})[method] = operation(op);
  }
  const tags = Array.isArray(raw['tags'])
    ? raw['tags'].filter(isObject).map((tag) => ({
        name: String(tag['name']),
        ...(typeof tag['description'] === 'string' ? { description: tag['description'] } : {}),
      }))
    : [];
  // Sorting keys keeps the shape it was built in.
  return sorted({
    info: isObject(raw['info']) ? raw['info'] : {},
    // In Java's order: the page lists its groups in it.
    tags,
    paths,
  }) as JavaDocumentation;
}

if (import.meta.main) {
  const response = await fetch(`${JAVA}/ContentService/v3/api-docs`);
  if (response.status !== 200) throw new Error(`api-docs: ${response.status}`);
  const raw: unknown = await response.json();
  writeFileSync(DOCUMENTATION, `${JSON.stringify(documentation(raw), null, 2)}\n`);
}
