/**
 * Write graph-names.json: names from the graph that standard form takes in
 * one spelling only (parameters.ts), because Java finds them leniently.
 *
 *  - The reference databases' names, for /data/mapping/{resource}/...:
 *    Java finds the resource ignoring case, so `UniProt` and `uNiPrOt` are
 *    one answer, which the edge would store twice.
 *  - The species' taxIds, for `species` on /data/pathways/low and
 *    /data/mapping: Java takes a number as a taxId, then as a Species dbId,
 *    and on /pathways/low an unknown one filters nothing -- so `species=1`
 *    is the unfiltered answer again, and the human Species dbId is 9606's.
 *
 * A name or species a release adds is not here until this is run again: its
 * URLs are answered, just not stored.
 *
 *   node tools/content-node/snapshot-graph-names.ts
 *
 * WHEN TO RUN IT: after a release. Two queries, through the service's own
 * graph settings.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, read } from './graph.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'graph-names.json');

const strings = (rows) => rows.map((row) => row.name).filter((name) => typeof name === 'string');
const referenceDatabases = strings(
  await read('MATCH (rd:ReferenceDatabase) RETURN DISTINCT rd.displayName AS name ORDER BY name')
);
const speciesTaxIds = strings(
  await read('MATCH (s:Species) RETURN DISTINCT s.taxId AS name ORDER BY name')
);
writeFileSync(OUT, `${JSON.stringify({ referenceDatabases, speciesTaxIds }, null, 2)}\n`);
console.log(
  `${OUT}: ${referenceDatabases.length} reference databases, ${speciesTaxIds.length} species`
);
await close();
