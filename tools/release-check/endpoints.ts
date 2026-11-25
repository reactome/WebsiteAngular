// A release's graph, checked through a host's content service (specs/032 T013,
// SC-003): at least 30 routes, every family the site reads, each answering 200
// with JSON of the shape the API description gives it -- and, given a second
// host serving the same release, the same answer there.
//
// The identifiers come from the host's own graph, read first (a top-level
// pathway of the species, a reaction and a sub-pathway in it, the reaction's
// participants, a complex among them, a protein's accession), so the check asks
// for things that exist in that release rather than ones remembered from
// another. People's routes are not asked: their answers are people's names.
// Nothing is printed of an answer but where it fails the description.
//
//     node tools/release-check/endpoints.ts --base https://host [--compare https://other]
import { readFileSync } from 'node:fs';
import { DESCRIPTION } from '../contract/generate.ts';
import { check, type Description } from '../api-types/schema.ts';

const PREFIX = '/ContentService';
const TIMEOUT_MS = 120_000;
const SPECIES = '9606';

/** The identifiers the routes are asked with, read from the host's graph. */
interface Found {
  pathway: string;
  subpathway: string;
  reaction: string;
  entity: string;
  complex: string;
  accession: string;
}

/** One route's outcome: what was asked, and what went wrong, if anything. */
interface Outcome {
  path: string;
  status: number;
  ms: number;
  problems: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

async function ask(
  base: string,
  path: string
): Promise<{ status: number; body: string; json: boolean; ms: number }> {
  const started = performance.now();
  const response = await fetch(base + PREFIX + path, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  const json = /json/.test(response.headers.get('content-type') ?? '');
  return { status: response.status, body, json, ms: Math.round(performance.now() - started) };
}

async function json(base: string, path: string): Promise<unknown> {
  const { status, body } = await ask(base, path);
  if (status !== 200) throw new Error(`${path} answered ${status} while finding identifiers`);
  return JSON.parse(body) as unknown;
}

/** Real identifiers, read from the host's own graph. */
async function findIdentifiers(base: string): Promise<Found> {
  const top = records(await json(base, `/data/pathways/top/${SPECIES}`));
  // A top-level pathway holding both a reaction and a pathway with a diagram.
  for (const candidate of top) {
    const pathway = text(candidate['stId']);
    if (!pathway) continue;
    const events = records(await json(base, `/data/pathway/${pathway}/containedEvents`));
    const reaction = events.find((e) => text(e['schemaClass'])?.endsWith('Reaction'));
    const subpathway = events.find(
      (e) => e['schemaClass'] === 'Pathway' && e['hasDiagram'] === true
    );
    const reactionId = reaction && text(reaction['stId']);
    const subpathwayId = subpathway && text(subpathway['stId']);
    if (!reactionId || !subpathwayId) continue;
    const entities = records(
      await json(base, `/data/participants/${reactionId}/participatingPhysicalEntities`)
    );
    const complex = entities.find((e) => e['schemaClass'] === 'Complex');
    const complexId = complex && text(complex['stId']);
    // A protein: a complex has no other forms, and its routes are asked above.
    const protein = entities.find((e) => e['schemaClass'] === 'EntityWithAccessionedSequence');
    const entityId = protein && text(protein['stId']);
    const references = records(
      await json(base, `/data/participants/${reactionId}/referenceEntities`)
    );
    const reference = references.find((r) => r['databaseName'] === 'UniProt');
    const accession = reference && text(reference['identifier']);
    if (!complexId || !entityId || !accession) continue;
    return {
      pathway,
      subpathway: subpathwayId,
      reaction: reactionId,
      entity: entityId,
      complex: complexId,
      accession,
    };
  }
  throw new Error(
    `no top-level pathway of ${SPECIES} holds a reaction with a complex and a protein, and a pathway with a diagram`
  );
}

/**
 * The site's own options for an object's details (database-object.service.ts):
 * the shape the description gives is that answer's, not the bare route's.
 */
const ENHANCED =
  '?fetchIncomingRelationships=true&summariseReferenceEntity=true&includeDisease=true&includeRef=true&view=nested-aggregated';

/** The routes asked, one or more of each family the site reads; no person's. */
export function routes(id: Found): string[] {
  const q = (term: string) => encodeURIComponent(term);
  return [
    '/data/database/version',
    '/data/database/name',
    '/data/species/main',
    '/data/species/all',
    `/data/pathways/top/${SPECIES}`,
    `/data/eventsHierarchy/${SPECIES}`,
    `/data/query/${id.pathway}`,
    `/data/query/${id.reaction}/stId`,
    `/data/query/enhanced/v2/${id.pathway}${ENHANCED}`,
    `/data/query/enhanced/v2/${id.reaction}${ENHANCED}`,
    `/data/query/enhanced/v2/${id.complex}${ENHANCED}`,
    `/data/query/enhanced/v2/${id.entity}${ENHANCED}`,
    `/data/discover/${id.pathway}`,
    `/data/event/${id.reaction}/ancestors`,
    `/data/pathway/${id.pathway}/containedEvents`,
    `/data/pathway/${id.pathway}/containedEvents/stId`,
    `/data/participants/${id.reaction}`,
    `/data/participants/${id.reaction}/participatingPhysicalEntities`,
    `/data/participants/${id.reaction}/referenceEntities`,
    `/data/detail/${id.reaction}/locationsInPWB`,
    `/data/complex/${id.complex}/subunits`,
    `/data/entity/${id.entity}/componentOf`,
    `/data/entity/${id.entity}/otherForms`,
    `/data/pathways/low/entity/${id.entity}`,
    `/data/pathways/low/diagram/entity/${id.entity}`,
    `/data/mapping/UniProt/${id.accession}/pathways`,
    `/data/mapping/UniProt/${id.accession}/reactions`,
    '/data/schema/model',
    '/data/diseases',
    `/interactors/static/molecule/${id.accession}/summary`,
    `/references/mapping/${id.accession}`,
    `/search/query?query=${q(id.accession)}`,
    `/search/suggest?query=${q(id.accession.slice(0, 4))}`,
    `/search/spellcheck?query=${q(id.accession)}`,
    '/search/facet',
    `/search/fireworks?query=${q(id.accession)}&species=${q('Homo sapiens')}`,
    `/search/diagram/${id.subpathway}?query=${q(id.accession)}`,
  ];
}

/** Each route asked of `base`: 200, JSON, as the description says, and as `compare` answers. */
export async function checkRoutes(
  base: string,
  paths: string[],
  description: Description,
  compare?: string
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  // One at a time: this is a check, not load, and a release server is busy.
  for (const path of paths) {
    const problems: string[] = [];
    let status = 0;
    let ms = 0;
    try {
      const answer = await ask(base, path);
      ({ status, ms } = answer);
      if (status !== 200) problems.push(`answered ${status}`);
      else if (!answer.json) {
        // A few routes answer text (a name, an identifier, a list of them).
        if (!answer.body.trim()) problems.push('answered nothing');
      } else {
        try {
          JSON.parse(answer.body);
          const [where = '', query = ''] = path.split('?');
          const found = check(description, [
            {
              method: 'GET',
              path: where,
              query: new URLSearchParams(query),
              source: base,
              body: answer.body,
            },
          ]).found;
          problems.push(...found);
        } catch {
          problems.push('not JSON');
        }
      }
      if (compare && status === 200) {
        const other = await ask(compare, path);
        if (other.status !== status || other.body !== answer.body)
          problems.push(`differs from ${compare} (${other.status})`);
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    outcomes.push({ path, status, ms, problems });
  }
  return outcomes;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

if (import.meta.main) {
  const base = option('base');
  if (!base) {
    console.error('usage: node tools/release-check/endpoints.ts --base URL [--compare URL]');
    process.exit(2);
  }
  const compare = option('compare');
  const description = JSON.parse(readFileSync(DESCRIPTION, 'utf8')) as Description;
  const found = await findIdentifiers(base);
  console.log(`identifiers from ${base}: ${Object.values(found).join(' ')}`);
  const outcomes = await checkRoutes(base, routes(found), description, compare);
  for (const o of outcomes)
    console.log(
      `${o.problems.length ? 'FAIL' : 'ok  '} ${o.status} ${o.ms}ms ${o.path}${o.problems.map((p) => `\n     ${p}`).join('')}`
    );
  const failed = outcomes.filter((o) => o.problems.length).length;
  console.log(
    `${outcomes.length - failed} of ${outcomes.length} as described${compare ? ` and as ${compare} answers` : ''}`
  );
  process.exit(failed ? 1 : 0);
}
