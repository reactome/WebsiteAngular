/**
 * The people-by-name comparison (spec 006 T073): Java against node over real
 * names, printing counts and indices only, never a name or a body. Names are
 * personal data, so content:diff -- which prints each path and its
 * differences -- is not used for these two endpoints with real names.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 NODE_CONTENT_SERVICE=http://127.0.0.1:4431 \
 *     node tools/content-node/people-name-check.ts
 *
 * The names are read from the graph the node service reads: a random 40
 * people, up to 10 who share an affiliation and a surname (one object written
 * once, then by its dbId), and up to 5 who share a whole name. Each is asked
 * four ways: the whole name exactly, the whole name, the surname in lower
 * case, and the whole name in the nested view with references. Spaced, for
 * the shared database. Exits 1 on any difference.
 */
import { createHash } from 'node:crypto';
import { close, read } from './graph.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
const NODE = process.env['NODE_CONTENT_SERVICE'] || 'http://127.0.0.1:4400';

interface Side {
  status: number;
  type: string;
  body: string;
}

async function get(base: string, path: string): Promise<Side> {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(120_000) });
  return {
    status: response.status,
    type: (response.headers.get('content-type') ?? '').split(';')[0] ?? '',
    body: await response.text(),
  };
}

/** An error body names the host that answered; nothing else may differ. */
function withoutUrl(body: string): string {
  try {
    const value = JSON.parse(body) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      delete (value as Record<string, unknown>)['url'];
      return JSON.stringify(value);
    }
  } catch {
    // Not JSON: compared as it is.
  }
  return body;
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 10);

async function main() {
  type Name = { first: string; last: string };
  const names = async (cypher: string) =>
    read<Name>(cypher).then((rows) => rows.filter((row) => row.first && row.last));
  const people = await names(
    'MATCH (p:Person) WHERE p.firstname IS NOT NULL AND p.surname IS NOT NULL ' +
      'RETURN p.firstname AS first, p.surname AS last ORDER BY rand() LIMIT 40'
  );
  const shared = await names(
    'MATCH (a:Person)-[:affiliation]->()<-[:affiliation]-(b:Person) ' +
      'WHERE a.surname = b.surname AND a.dbId < b.dbId ' +
      'RETURN a.firstname AS first, a.surname AS last LIMIT 10'
  );
  const same = await names(
    'MATCH (p:Person) WITH p.firstname AS first, p.surname AS last, count(*) AS people ' +
      'WHERE people > 1 RETURN first, last LIMIT 5'
  );
  await close();
  const picked = [...people, ...shared, ...same];
  console.log(
    `picked ${picked.length}: ${people.length} at random, ${shared.length} sharing an ` +
      `affiliation and a surname, ${same.length} sharing a whole name`
  );

  const root = '/ContentService/data/people/name/';
  const paths = picked.flatMap(({ first, last }) => {
    const whole = encodeURIComponent(`${first} ${last}`);
    return [
      `${root}${whole}/exact`,
      `${root}${whole}`,
      `${root}${encodeURIComponent(last.toLowerCase())}`,
      `${root}${whole}?view=nested&includeRef=true`,
    ];
  });

  let identical = 0;
  let different = 0;
  for (const [index, path] of paths.entries()) {
    const java = await get(JAVA, path);
    const node = await get(NODE, path);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (
      java.status === node.status &&
      java.type === node.type &&
      withoutUrl(java.body) === withoutUrl(node.body)
    ) {
      identical += 1;
      continue;
    }
    different += 1;
    const kind = java.status !== node.status ? 'status' : java.type !== node.type ? 'type' : 'body';
    console.log(
      `  #${index}: ${kind} differs (java ${java.status} ${hash(java.body)}, ` +
        `node ${node.status} ${hash(node.body)})`
    );
  }
  console.log(`compared ${paths.length}: ${identical} identical, ${different} different`);
  process.exit(different ? 1 : 0);
}

await main();
