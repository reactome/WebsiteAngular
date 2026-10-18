/**
 * Write reference-databases.json: the names of the graph's reference
 * databases, as /data/mapping/{resource}/... is standard only for one of
 * them, exactly as written (parameters.mjs). Java finds the resource
 * ignoring case, so `UniProt`, `uniprot` and `uNiPrOt` are one answer; at
 * the edge each would be stored again. A name the release adds is not here
 * until this is run again: its URLs are answered, just not stored.
 *
 *   node tools/content-node/snapshot-reference-databases.mjs
 *
 * WHEN TO RUN IT: after a release, with the snapshots of the graph's model.
 * One query, through the service's own graph settings.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, read } from './graph.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference-databases.json');

const rows = await read(
  'MATCH (rd:ReferenceDatabase) RETURN DISTINCT rd.displayName AS name ORDER BY name'
);
const names = rows.map((row) => row.name).filter((name) => typeof name === 'string');
writeFileSync(OUT, `${JSON.stringify(names, null, 2)}\n`);
console.log(`${OUT}: ${names.length} reference databases`);
await close();
