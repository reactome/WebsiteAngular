/**
 * Records the Java ContentService's answers for the interactor operations that
 * spec 033 moves to node, with the inputs Java had at that moment, into
 * fixtures/interactors-java/ (spec 033 T002). Run by hand, once:
 *
 *   JAVA_CONTENT_SERVICE=<the Java service's base, ending in /ContentService> \
 *     node tools/content-node/record-interactors-java.ts
 *
 * What it records, one request at a time with a pause between:
 * - each PSICQUIC operation for two resources (MINT, which sends its own
 *   score, and BioGRID, whose score Java computes) and three accessions, and
 *   the MITAB each resource served for them, fetched straight after;
 * - the first page of descendants EBI's ontology service gives for each of
 *   the eight branches the MI-score reads (research-psicquic.md §6): the page
 *   Java gets, not the whole branch;
 * - the error cases of research R1;
 * - one upload of each format, and a custom PSICQUIC registration, from a
 *   server this script starts on loopback (placeholder data only), and a token
 *   read for each.
 *
 * MITAB's first-author column (the eighth) is replaced by a placeholder before
 * it is written (the fixtures' names policy): nothing the score or the
 * clustering reads.
 *
 * Why a script rather than a recording of the site: the MITAB and the ontology
 * pages must be taken at the same moment as Java's answers, or a change at a
 * third-party server reads as a difference in the port.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { registryServices } from './psicquic.ts';
import { settings } from './settings.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'];
if (!JAVA)
  throw new Error(
    'JAVA_CONTENT_SERVICE names the Java service to record, ending in /ContentService'
  );
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'interactors-java');
mkdirSync(path.join(OUT, 'mitab'), { recursive: true });
mkdirSync(path.join(OUT, 'ontology'), { recursive: true });

/** Between two requests to the Java service: it asks third-party servers in turn. */
const PAUSE_MS = 5_000;
/** Java has no timeout of its own (research R3); this only stops a run that hangs. */
const LIMIT_MS = 600_000;

const RESOURCES = ['MINT', 'BioGrid'];
const ACCESSIONS = ['P04637', 'Q14204', 'Q13409'];
/** The MI-score's eight branches (research-psicquic.md §6). */
const BRANCHES = [
  'MI:0013',
  'MI:0090',
  'MI:0254',
  'MI:0255',
  'MI:0401',
  'MI:0428',
  'MI:0208',
  'MI:0407',
];
const OLS = 'https://www.ebi.ac.uk/ols/api/ontologies/mi/terms';

/** The headers a recording keeps: what node must write the same. */
const KEPT_HEADERS = ['content-type', 'content-disposition'];

interface Recorded {
  request: { method: string; path: string; contentType?: string; body?: string };
  status: number;
  headers: Record<string, string>;
  body: string;
  recordedAt: string;
  milliseconds: number;
}

async function record(
  name: string,
  method: 'GET' | 'POST',
  route: string,
  options: { contentType?: string; body?: string | FormData } = {}
) {
  const started = Date.now();
  const init: RequestInit = { method, signal: AbortSignal.timeout(LIMIT_MS) };
  if (options.body !== undefined) init.body = options.body;
  if (options.contentType) init.headers = { 'Content-Type': options.contentType };
  const response = await fetch(`${JAVA}${route}`, init);
  const body = await response.text();
  const headers: Record<string, string> = {};
  for (const header of KEPT_HEADERS) {
    const value = response.headers.get(header);
    if (value !== null) headers[header] = value;
  }
  const written: Recorded = {
    request: {
      method,
      path: route,
      ...(options.contentType && { contentType: options.contentType }),
      ...(typeof options.body === 'string' && { body: options.body }),
    },
    status: response.status,
    headers,
    body,
    recordedAt: new Date(started).toISOString(),
    milliseconds: Date.now() - started,
  };
  writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(written, null, 2)}\n`);
  console.log(`${name}: ${response.status} in ${written.milliseconds} ms`);
  await sleep(PAUSE_MS);
  return written;
}

/**
 * MITAB 2.5's eighth column (index 7), the first authors, replaced: the policy
 * on names. The seventh, before it, is the detection method, which the
 * MI-score reads: an earlier draft blanked that one by mistake, which the
 * check below now refuses.
 */
const AUTHOR_COLUMN = 7;
function withoutAuthors(mitab: string) {
  return mitab
    .split('\n')
    .map((line) => {
      const columns = line.split('\t');
      if (columns.length < 15) return line;
      if (!/psi-mi:/.test(columns[AUTHOR_COLUMN - 1] ?? '') && columns[AUTHOR_COLUMN - 1] !== '-')
        throw new Error(
          `not MITAB 2.5's columns: no detection method before the authors in ${line.slice(0, 80)}`
        );
      columns[AUTHOR_COLUMN] = columns[AUTHOR_COLUMN] === '-' ? '-' : 'Placeholder et al. (2000)';
      return columns.join('\t');
    })
    .join('\n');
}

async function recordMitab() {
  const registry = await fetch(
    `${settings.psicquicRegistryUrl()}registry?action=STATUS&format=xml`,
    {
      signal: AbortSignal.timeout(60_000),
    }
  );
  const services = registryServices(await registry.text());
  for (const resource of RESOURCES) {
    const service = services.find((s) => s.name?.toLowerCase() === resource.toLowerCase());
    if (!service?.restUrl) throw new Error(`the registry lists no ${resource}`);
    for (const accession of ACCESSIONS) {
      const response = await fetch(
        `${service.restUrl}interactor/${encodeURIComponent(accession)}`,
        {
          signal: AbortSignal.timeout(120_000),
        }
      );
      const mitab = withoutAuthors(await response.text());
      // Compressed: one resource's MITAB for a well-studied protein runs to megabytes.
      writeFileSync(
        path.join(OUT, 'mitab', `${resource.toLowerCase()}-${accession}.tsv.gz`),
        gzipSync(mitab, { level: 9 })
      );
      console.log(
        `MITAB ${resource} ${accession}: ${response.status}, ${mitab.split('\n').filter(Boolean).length} lines`
      );
      await sleep(1_000);
    }
  }
}

interface OlsTerms {
  _embedded?: { terms?: { _links?: { descendants?: { href?: string } } }[] };
}

async function recordOntology() {
  for (const branch of BRANCHES) {
    const term = await fetch(`${OLS}?obo_id=${branch}`, { signal: AbortSignal.timeout(60_000) });
    const termText = await term.text();
    const href = (JSON.parse(termText) as OlsTerms)._embedded?.terms?.[0]?._links?.descendants
      ?.href;
    if (!href) throw new Error(`no descendants link for ${branch}`);
    // `size` as miscore asks for it; the service answers its first page (research R1).
    const page = await fetch(`${href}?size=1000`, { signal: AbortSignal.timeout(60_000) });
    const file = branch.replace(':', '_');
    writeFileSync(path.join(OUT, 'ontology', `${file}.term.json`), termText);
    writeFileSync(path.join(OUT, 'ontology', `${file}.descendants.json`), await page.text());
    console.log(`ontology ${branch}: ${page.status}`);
    await sleep(1_000);
  }
}

/** Placeholder files the uploads read, and a custom PSICQUIC service, on loopback. */
const TUPLE = '#ID_A\tID_B\nP04637\tQ14204\nP04637\tQ13409\nQ14204\tQ13409\n';
const EXTENDED =
  '#ID A\tID B\tALIAS A\tALIAS B\tEVIDENCE\tSCORE\n' +
  'P04637\tQ14204\tTP53\tDYNC1H1\t10000001\t0.8\n' +
  'P04637\tQ13409\tTP53\tDYNC1I2\t10000002\t0.3\n';
/** One MITAB 2.5 line between two accessions, every column a placeholder but those the score reads. */
function mitabLine(a: string, b: string, n: number) {
  return [
    `uniprotkb:${a}`,
    `uniprotkb:${b}`,
    '-',
    '-',
    `uniprotkb:${a}_alias(gene name)`,
    `uniprotkb:${b}_alias(gene name)`,
    'psi-mi:"MI:0018"(two hybrid)',
    'Placeholder et al. (2000)',
    `pubmed:1000000${n}`,
    'taxid:9606(human)',
    'taxid:9606(human)',
    'psi-mi:"MI:0915"(physical association)',
    'psi-mi:"MI:0469"(IntAct)',
    `intact:EBI-000000${n}`,
    '-',
  ].join('\t');
}
const PSIMITAB = `${[mitabLine('P04637', 'Q14204', 1), mitabLine('P04637', 'Q13409', 2)].join('\n')}\n`;

function startFiles() {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url === '/tuple.txt') return void response.end(TUPLE);
    const custom = /^\/psicquic\/([^/?]+)/.exec(url)?.[1];
    if (custom) {
      const accession = decodeURIComponent(custom);
      const lines = [mitabLine('P04637', 'Q14204', 1), mitabLine('P04637', 'Q13409', 2)].filter(
        (l) => l.includes(`uniprotkb:${accession}\t`)
      );
      return void response.end(lines.length ? `${lines.join('\n')}\n` : '');
    }
    response.statusCode = 404;
    response.end();
  });
  return new Promise<{ base: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    })
  );
}

interface Uploaded {
  summary?: { token?: string };
}

async function main() {
  // The inputs first, then Java's answers straight after them.
  await recordMitab();
  await recordOntology();

  const body = ACCESSIONS.join(',');
  for (const resource of RESOURCES) {
    const r = resource.toLowerCase();
    await record(
      `post-${r}-details`,
      'POST',
      `/interactors/psicquic/molecules/${resource}/details`,
      {
        contentType: 'text/plain',
        body,
      }
    );
    await record(
      `post-${r}-summary`,
      'POST',
      `/interactors/psicquic/molecules/${resource}/summary`,
      {
        contentType: 'text/plain',
        body,
      }
    );
    await record(
      `get-${r}-${ACCESSIONS[1]}-details`,
      'GET',
      `/interactors/psicquic/molecule/${resource}/${ACCESSIONS[1]}/details`
    );
    await record(
      `get-${r}-${ACCESSIONS[1]}-summary`,
      'GET',
      `/interactors/psicquic/molecule/${resource}/${ACCESSIONS[1]}/summary`
    );
  }

  // The errors of research R1.
  await record(
    'error-unknown-resource',
    'GET',
    '/interactors/psicquic/molecule/no-such-resource/P04637/details'
  );
  await record('error-empty-body', 'POST', '/interactors/psicquic/molecules/MINT/details', {
    contentType: 'text/plain',
    body: '',
  });
  // Not an accession of anything: the answer for one with no interactions.
  await record(
    'error-unknown-accession',
    'GET',
    '/interactors/psicquic/molecule/MINT/NOT_AN_ACCESSION/details'
  );

  const files = await startFiles();
  try {
    const tokens: string[] = [];
    const remember = (answer: Recorded) => {
      const token = (JSON.parse(answer.body) as Uploaded).summary?.token;
      if (token) tokens.push(token);
    };
    remember(
      await record(
        'upload-content-tuple',
        'POST',
        '/interactors/upload/tuple/content?name=placeholder-tuple',
        {
          contentType: 'text/plain',
          body: TUPLE,
        }
      )
    );
    remember(
      await record(
        'upload-content-extended',
        'POST',
        '/interactors/upload/tuple/content?name=placeholder-extended',
        {
          contentType: 'text/plain',
          body: EXTENDED,
        }
      )
    );
    remember(
      await record(
        'upload-content-psimitab',
        'POST',
        '/interactors/upload/tuple/content?name=placeholder-psimitab',
        {
          contentType: 'text/plain',
          body: PSIMITAB,
        }
      )
    );
    const form = new FormData();
    form.append('file', new Blob([TUPLE], { type: 'text/plain' }), 'placeholder.txt');
    remember(
      await record(
        'upload-form-tuple',
        'POST',
        '/interactors/upload/tuple/form?name=placeholder-form',
        { body: form }
      )
    );
    remember(
      await record(
        'upload-url-tuple',
        'POST',
        '/interactors/upload/tuple/url?name=placeholder-url',
        {
          contentType: 'text/plain',
          body: `${files.base}/tuple.txt`,
        }
      )
    );
    remember(
      await record(
        'upload-psicquic-url',
        'POST',
        '/interactors/upload/psicquic/url?name=placeholder-psicquic',
        {
          contentType: 'text/plain',
          body: `${files.base}/psicquic`,
        }
      )
    );
    for (const token of [...new Set(tokens)])
      await record(`token-${token}`, 'POST', `/interactors/token/${token}`, {
        contentType: 'text/plain',
        body,
      });
    await record(
      'error-unknown-token',
      'POST',
      '/interactors/token/00000000000000000000000000000000',
      {
        contentType: 'text/plain',
        body,
      }
    );
  } finally {
    files.close();
  }
}

await main();
