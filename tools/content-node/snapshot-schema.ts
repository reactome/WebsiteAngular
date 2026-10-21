/**
 * Write schema-snapshot.json: Java's answers for the parts of /data/schema that
 * are reflection over graph-core's classes, captured once and served by node.
 *
 *   node tools/content-node/snapshot-schema.ts            # Java on :8080
 *   JAVA_CONTENT_SERVICE=http://host:port node tools/content-node/snapshot-schema.ts
 *
 * What it captures, from the running Java ContentService:
 *
 *  - /data/schema/{className}/attributes and /referrals for every class in
 *    schema.ts. Both are DatabaseObjectUtils.getAttributeTable/getReferrals:
 *    reflection, no database, so the answer only changes when graph-core does.
 *  - The same two for every woven `$AjcClosure` class. Java answers those too
 *    (they extend AspectJ's AroundClosure); they must all be one answer, which
 *    is stored once as `closure` -- the script stops if any differs.
 *  - /data/schema/model, whole. Node does not serve it: the tree's counts are
 *    the graph's and are computed live (schema-endpoints.ts, schemaModelTree). It is
 *    kept so that schema.spec.ts can rebuild Java's tree from its own counts
 *    with schema.ts's hierarchy and compare bytes -- the check that the
 *    hierarchy and the tree building are Java's, without a database.
 *
 * WHEN TO RUN IT: whenever graph-core's model changes -- the same trigger as
 * updating schema.ts (see its header), and in the same commit. The owner's
 * view (Oct 2026) is that the model "will not be changing any time soon". The
 * script refuses to write a snapshot whose classes differ from schema.ts's,
 * so the two cannot drift apart silently: update schema.ts first.
 *
 * Stored compactly (schema.ts's schemaSnapshot says the shape): each class's
 * own attribute rows once, rather than again in every subclass's table, and
 * each distinct referral row once. Captured whole the file was 376KB; most of
 * it was DatabaseObject's rows repeated 113 times.
 *
 * Checked before anything is written: every answer round-trips -- JSON.parse
 * then javaJson gives back Java's exact bytes -- and every class's two
 * answers, rebuilt from the compact form by schema.ts exactly as node serves
 * them, are Java's bytes.
 *
 * Sequential and gentle on purpose: /referrals scans the classpath on every
 * request (~120ms each), and Java is serving the site.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AJC_CLOSURE_NAMES, attributeTable, referralsTable, SCHEMA_CLASSES } from './schema.ts';
import type { SchemaTables } from './schema.ts';
import type { SchemaAttribute } from '../../projects/website-angular/src/model/content.model.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema-snapshot.json');

/** As service.ts's javaJson; repeated so this script needs no graph. */
const javaJson = (value: unknown) =>
  JSON.stringify(value).replace(/(\\+)u00([0-9a-f]{2})/g, (match, slashes, hex) =>
    slashes.length % 2 ? `${slashes}u00${hex.toUpperCase()}` : match
  );

async function get(pathname: string) {
  const response = await fetch(`${JAVA}/ContentService/data${pathname}`);
  const text = await response.text();
  if (response.status !== 200) throw new Error(`${pathname}: ${response.status} ${text}`);
  const value = JSON.parse(text);
  if (javaJson(value) !== text) throw new Error(`${pathname}: does not round-trip byte for byte`);
  return value;
}

const classes = Object.keys(SCHEMA_CLASSES).sort();
const attributes: Record<string, SchemaAttribute[]> = {};
const referrals: Record<string, SchemaAttribute[]> = {};
/** A class's answer, fetched above for every class. */
const answered = (map: Record<string, SchemaAttribute[]>, name: string) => {
  const rows = map[name];
  if (!rows) throw new Error(`${name}: not fetched`);
  return rows;
};
for (const name of classes) {
  attributes[name] = await get(`/schema/${encodeURIComponent(name)}/attributes`);
  referrals[name] = await get(`/schema/${encodeURIComponent(name)}/referrals`);
}

let closure: SchemaTables['closure'] | undefined;
for (const name of AJC_CLOSURE_NAMES) {
  const answer = {
    attributes: await get(`/schema/${encodeURIComponent(name)}/attributes`),
    referrals: await get(`/schema/${encodeURIComponent(name)}/referrals`),
  };
  closure ??= answer;
  if (javaJson(answer) !== javaJson(closure)) {
    throw new Error(`${name}: answers differently from ${AJC_CLOSURE_NAMES[0]}; store it per name`);
  }
}

const model = await get('/schema/model');
const release = await get('/database/version');

const declared: Record<string, SchemaAttribute[]> = {};
for (const name of classes) {
  declared[name] = answered(attributes, name).filter((row) => row.origin === name);
}
const referralRows: SchemaAttribute[] = [];
const rowIndex = new Map<string, number>();
const referralIndexes: Record<string, number[]> = {};
for (const name of classes) {
  referralIndexes[name] = answered(referrals, name).map((row) => {
    const key = javaJson(row);
    let at = rowIndex.get(key);
    if (at === undefined) {
      at = referralRows.length;
      rowIndex.set(key, at);
      referralRows.push(row);
    }
    return at;
  });
}

if (!closure) throw new Error('no closure class answered');
const data: SchemaTables = { declared, referralRows, referrals: referralIndexes, closure };
for (const name of classes) {
  if (javaJson(attributeTable(name, data)) !== javaJson(attributes[name])) {
    throw new Error(`${name}/attributes: not rebuilt as Java answers it from its superclasses`);
  }
  if (javaJson(referralsTable(name, data)) !== javaJson(referrals[name])) {
    throw new Error(`${name}/referrals: not rebuilt as Java answers it`);
  }
}

// One line per class or row, so that a regeneration's diff names what changed.
const lines = (entries: string[]) => entries.map((entry) => `    ${entry}`).join(',\n');
const byName = (map: Record<string, unknown>) =>
  lines(Object.keys(map).map((name) => `${JSON.stringify(name)}: ${javaJson(map[name])}`));
const text =
  '{\n' +
  `  "release": ${javaJson(release)},\n` +
  `  "declared": {\n${byName(declared)}\n  },\n` +
  `  "referralRows": [\n${lines(referralRows.map(javaJson))}\n  ],\n` +
  `  "referrals": {\n${byName(referralIndexes)}\n  },\n` +
  `  "closure": ${javaJson(closure)},\n` +
  `  "model": ${javaJson(model)}\n` +
  '}\n';
writeFileSync(OUT, text);
console.log(
  `wrote ${OUT}: ${classes.length} classes, ${AJC_CLOSURE_NAMES.length} closures, ` +
    `${Buffer.byteLength(text)} bytes`
);
