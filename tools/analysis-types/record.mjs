/**
 * Record real AnalysisService answers for the kinds of analysis the end-to-end
 * recordings never run (spec 010 Story 5): an expression analysis with
 * interactors, gene names with identifiers not found, and metabolites. Each
 * is run once with an example file from the site's assets, projected to human
 * as the site always asks, and then read the ways the site reads a result.
 *
 *     node tools/analysis-types/record.mjs [origin]    default http://127.0.0.1:8080
 *
 * One request at a time, a pause between analyses: it runs against a shared
 * service. Only the first page of pathways is kept, as the site's table asks
 * for. Writes tools/analysis-types/recorded/<name>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const EXAMPLES = path.join(
  HERE,
  '../../projects/pathway-browser/src/assets/data/analysis-examples'
);
const OUT = path.join(HERE, 'recorded');

const RUNS = [
  {
    name: 'expression',
    file: 'demo.tsv',
    path: 'identifiers/projection?interactors=true&pageSize=20&page=1',
  },
  { name: 'gene-names', file: 'gene-name.tsv', path: 'identifiers/projection?pageSize=20&page=1' },
  {
    name: 'metabolites',
    file: 'metabolomics.tsv',
    path: 'identifiers/projection?pageSize=20&page=1',
  },
];

async function call(origin, method, route, body) {
  const answer = await fetch(`${origin}/AnalysisService/${route}`, {
    method,
    ...(body !== undefined && { body, headers: { 'Content-Type': 'text/plain' } }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await answer.text();
  if (answer.status !== 200)
    throw new Error(`${method} ${route}: ${answer.status} ${text.slice(0, 200)}`);
  return text;
}

async function main([origin = 'http://127.0.0.1:8080'] = []) {
  mkdirSync(OUT, { recursive: true });
  for (const run of RUNS) {
    const data = readFileSync(path.join(EXAMPLES, run.file), 'utf8');
    const result = await call(origin, 'POST', run.path, data);
    const { summary, pathways } = JSON.parse(result);
    // Sent as the service gives it, already escaped, as the site sends it.
    const token = summary.token;
    // One with interactors found, where there is one, so their shape is seen too.
    const pathway = (
      pathways.find((p) => p.entities.interactorsFound > 0) ??
      pathways.find((p) => p.llp) ??
      pathways[0]
    ).stId;
    const answers = [
      { route: `POST /AnalysisService/${run.path}`, body: result },
      {
        route: 'GET /AnalysisService/token/T',
        body: await call(origin, 'GET', `token/${token}?pageSize=20&page=1`),
      },
      {
        route: `GET /AnalysisService/token/T/found/all/${pathway}`,
        body: await call(origin, 'GET', `token/${token}/found/all/${pathway}?resource=TOTAL`),
      },
      {
        route: 'POST /AnalysisService/token/T/filter/pathways',
        body: await call(origin, 'POST', `token/${token}/filter/pathways?resource=TOTAL`, pathway),
      },
      {
        route: `GET /AnalysisService/token/T/reactions/${pathway}`,
        body: await call(origin, 'GET', `token/${token}/reactions/${pathway}?resource=TOTAL`),
      },
      {
        route: 'GET /AnalysisService/token/T/notFound',
        body: await call(origin, 'GET', `token/${token}/notFound?pageSize=40&page=1`),
      },
    ];
    writeFileSync(
      path.join(OUT, `${run.name}.json`),
      JSON.stringify(
        answers.map((a) => ({ route: a.route, answer: JSON.parse(a.body) })),
        null,
        1
      ) + '\n'
    );
    console.log(`${run.name}: ${summary.type}, ${answers.length} answers`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

await main(process.argv.slice(2));
