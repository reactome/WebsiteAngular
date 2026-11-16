/**
 * Node's analysis sizes against Java's (spec 006 T103a, research D25): for
 * every species with a top-level pathway in the graph -- those Java has a
 * hierarchy for, each of which must answer -- each pathway's
 * totalEntity and totalEntityAndInteractors in Java's
 * /data/eventsHierarchy/{taxId}?pathwaysOnly=true, against analysisSizes.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 node tools/content-node/analysis-sizes-check.ts
 *
 * Passes when the only differences are those recorded in
 * fixtures/analysis-size-differences.json (analysis-core's alias merge,
 * reactome/analysis-core#13), each with the values recorded; fails on any
 * other difference, a pathway one side lacks, a species that does not answer,
 * or a recorded difference gone -- as when analysis-core is fixed, and the
 * record should go with it. Which interactor analysis-core's merge keeps
 * depends on its build order, so a rebuilt data file may move a recorded Java
 * value: the record is then measured again.
 */
import { readFileSync } from 'node:fs';
import { analysisSizes } from './analysis-sizes.ts';
import { close, read } from './graph.ts';

type JavaNode = {
  stId: string;
  totalEntity: number;
  totalEntityAndInteractors: number;
  children?: JavaNode[];
};
type Recorded = Record<string, Record<string, { java: number; node: number }>>;

const JAVA = process.env['JAVA_CONTENT_SERVICE'] ?? 'http://localhost:8080';
const recorded = (
  JSON.parse(
    readFileSync(new URL('./fixtures/analysis-size-differences.json', import.meta.url), 'utf8')
  ) as { differences: Recorded }
).differences;

const problems: string[] = [];
const species = await read<{ taxId: string; name: string }>(
  `MATCH (:TopLevelPathway)-[:species]->(s:Species)
   RETURN DISTINCT s.taxId AS taxId, s.displayName AS name ORDER BY name`
);
let checked = 0;
for (const { taxId, name: displayName } of species) {
  const answer = await fetch(
    `${JAVA}/ContentService/data/eventsHierarchy/${taxId}?pathwaysOnly=true`
  );
  if (answer.status !== 200) {
    problems.push(`${taxId} ${displayName}: Java answered ${answer.status}`);
    continue;
  }
  const tree = (await answer.json()) as JavaNode[];
  const sizes = await analysisSizes(taxId);
  const expected = recorded[taxId] ?? {};
  const seen = new Set<string>();
  const walk = (node: JavaNode) => {
    const mine = sizes.get(node.stId);
    if (!mine) problems.push(`${taxId} ${node.stId}: in Java's tree, not node's`);
    else {
      if (mine.totalEntity !== node.totalEntity)
        problems.push(
          `${taxId} ${node.stId} totalEntity: Java ${node.totalEntity}, node ${mine.totalEntity}`
        );
      const record = expected[node.stId];
      const java = node.totalEntityAndInteractors;
      const ours = mine.totalEntityAndInteractors;
      if (record) {
        seen.add(node.stId);
        if (record.java !== java || record.node !== ours)
          problems.push(
            `${taxId} ${node.stId} totalEntityAndInteractors: recorded Java ${record.java}, node ${record.node}; now Java ${java}, node ${ours}`
          );
      } else if (java !== ours)
        problems.push(
          `${taxId} ${node.stId} totalEntityAndInteractors: Java ${java}, node ${ours}`
        );
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of tree) walk(node);
  const javas = new Set<string>();
  const collect = (node: JavaNode) => {
    javas.add(node.stId);
    for (const child of node.children ?? []) collect(child);
  };
  for (const node of tree) collect(node);
  for (const stId of sizes.keys())
    if (!javas.has(stId)) problems.push(`${taxId} ${stId}: in node's tree, not Java's`);
  for (const stId of Object.keys(expected))
    if (!seen.has(stId)) problems.push(`${taxId} ${stId}: recorded, but not in Java's tree`);
  checked++;
  console.log(`${taxId} ${displayName}: ${sizes.size} pathways`);
}
for (const taxId of Object.keys(recorded))
  if (!species.some((s) => s.taxId === taxId))
    problems.push(`${taxId}: recorded, but no top-level pathway`);
await close();

if (species.length === 0) problems.push('no species with a top-level pathway: is the graph there?');
console.log(problems.length ? problems.join('\n') : `${checked} species: as recorded.`);
process.exitCode = problems.length ? 1 : 0;
