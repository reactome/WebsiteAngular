/**
 * What the search endpoints share, as search-core's SolrConverter and
 * SearchService build it (spec 014, research R1, a shared module above
 * search-params): a Solr document as an Entry, a Solr failure as Java
 * answers it, the occurrences of a term in a diagram, and the targets and
 * not-found report of a search that found nothing. Shared by the search
 * and diagram-search families. Moved unchanged from service.ts.
 */
import type { Request } from './endpoint.ts';
import type { Failure, Written } from './answers.ts';
import { javaError } from './answers.ts';
import type { SolrAnswer, SolrDoc, SolrValue } from './solr.ts';
import {
  JavaNumberFormat,
  caseInsensitive,
  javaParseInt,
  javaSplit,
  javaTrimAll,
} from './java-text.ts';
import { JavaHashMap } from './java-hashmap.ts';
import { databaseVersion } from './release.ts';
import { solr } from './solr.ts';
import { SCOPE_FILTER, pair } from './search-params.ts';
import type { ReportInfo } from './report.ts';
import { sendReport } from './report.ts';
import type { FacetCount } from '../../projects/website-angular/src/model/search.model.ts';

/**
 * The answer `work` makes from Solr, or the one Java makes when Solr cannot
 * be asked. `work` is given a signal that aborts when the client goes away
 * -- the search box, a keystroke later -- which takes its waiting Solr calls
 * with it. A queue too long to join is a 503 to retry; any other failure is
 * Java's GlobalExceptionHandler 500, whose message repeats the parameters
 * sent to Solr -- this one says only what failed.
 */
export async function fromSolr<T>(
  request: Request,
  path: string,
  work: (signal: AbortSignal) => Promise<T>
) {
  const gone = new AbortController();
  const { res } = request;
  res?.on('close', () => {
    if (!res.writableFinished) gone.abort();
  });
  try {
    return await work(gone.signal);
  } catch (caught) {
    const failure = caught as Failure;
    if (gone.signal.aborted) return { status: 500 };
    if (failure.busy)
      return {
        ...javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly'),
        headers: { 'Retry-After': '5' },
      };
    console.error(`${path}: ${failure.message}`);
    // What Java answers when its own code fails, not Solr: any exception
    // but a NullPointerException with its own message (handleUnclassified),
    // a NullPointerException with its fixed one, through GlobalExceptionHandler.
    if (failure.javaMessage)
      return javaError(request, 500, 'INTERNAL_SERVER_ERROR', failure.javaMessage);
    if (failure.unexpected)
      return javaError(
        request,
        500,
        'INTERNAL_SERVER_ERROR',
        'Something unexpected happened and the error has been reported.'
      );
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', 'Solr exception occurred');
  }
}

/**
 * search-core's FacetContainer: a facet's name, absent for an unnamed one,
 * and its count -- the site's FacetCount, one definition (spec 013 T019).
 */
export type FacetContainer = FacetCount;

export function facetContainer(name: string | null, count: number): FacetContainer {
  return name === null || name === '' ? { count } : { name, count };
}

/** SolrDocument.getFieldValue: a multi-valued field's first value. */
export function solrValue(doc: SolrDoc, field: string) {
  const value = doc[field];
  return Array.isArray(value) ? value[0] : value;
}

/** SolrConverter.getStringListField: every value as a string; none, the empty list. */
export function solrStrings(doc: SolrDoc, field: string) {
  const value = doc[field];
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item));
}

/** String.isBlank: nothing but Character.isWhitespace. */
function javaIsBlank(text: string) {
  return javaTrimAll(text) === '';
}

/**
 * An icon's physical entities, each packed "stId#type#name#compartments",
 * unpacked as search-core's IconPhysicalEntity -- whose displayName getter
 * Jackson writes too -- in a TreeSet: ordered by display name, ignoring case
 * as compareToIgnoreCase does, and so one of each such name. Fewer than four
 * parts is Java's ArrayIndexOutOfBoundsException, a failure here too.
 */
function iconPhysicalEntities(doc: SolrDoc) {
  const set: Record<string, string>[] = [];
  // Each entity's display name, kept apart: NON_EMPTY may leave it out of
  // what is written, but the TreeSet still orders by it.
  const names: string[] = [];
  for (const packed of solrStrings(doc, 'iconPhysicalEntities')) {
    const [stId, type, name, compartments] = fourParts(packed, '#', [0, 1, 2, 3]);
    const displayName = name + (javaIsBlank(compartments) ? '' : ` [${compartments}]`);
    const at = names.findIndex((other) => caseInsensitive(displayName, other) <= 0);
    if (at > -1 && caseInsensitive(displayName, names[at] as string) === 0) continue;
    const where = at === -1 ? set.length : at;
    // NON_EMPTY reaches into the bean: an empty part is left out.
    const parts = Object.entries({ stId, type, name, compartments, displayName });
    set.splice(where, 0, Object.fromEntries(parts.filter(([, value]) => value !== '')));
    names.splice(where, 0, displayName);
  }
  return set;
}

/** selectRightReferenceIdentifier: the first identifier with no ':', else the first. */
function referenceIdentifier(doc: SolrDoc) {
  if (doc['referenceIdentifiers'] === undefined || doc['referenceIdentifiers'] === null)
    return null;
  const values = solrStrings(doc, 'referenceIdentifiers');
  return values.find((value) => !value.includes(':')) ?? values[0] ?? null;
}

/** Entry's properties in Jackson's order: its fields as declared. */
const ENTRY_FIELDS = [
  'dbId',
  'stId',
  'id',
  'name',
  'type',
  'instanceTypeExplanation',
  'exactType',
  'species',
  'summation',
  'referenceName',
  'referenceIdentifier',
  'compartmentNames',
  'compartmentAccession',
  'isDisease',
  'hasReferenceEntity',
  'hasEHLD',
  'databaseName',
  'referenceURL',
  'regulator',
  'regulatedEntity',
  'regulatorId',
  'regulatedEntityId',
  'authoredPathways',
  'authoredReactions',
  'reviewedPathways',
  'reviewedReactions',
  'orcidId',
  'fireworksSpecies',
  'iconName',
  'iconCategories',
  'iconCuratorName',
  'iconCuratorOrcidId',
  'iconCuratorUrl',
  'iconDesignerName',
  'iconDesignerOrcidId',
  'iconDesignerUrl',
  'iconReferences',
  'iconPhysicalEntities',
  'iconEhlds',
  'deleted',
  'reason',
  'explanation',
  'date',
  'replacementDbIds',
  'replacementStIds',
];

/** An Entry being built: the fields set after the document's own. */
type DraftEntry = {
  [field: string]: unknown;
  dbId: SolrValue | undefined;
  isDisease: unknown;
  referenceIdentifier?: unknown;
  name?: unknown;
  summation?: unknown;
  referenceName?: unknown;
  regulator?: unknown;
  regulatedEntity?: unknown;
  fireworksSpecies?: unknown;
  iconName?: unknown;
  iconCategories?: unknown;
  iconReferences?: unknown;
  iconEhlds?: unknown;
  iconPhysicalEntities?: unknown;
  deleted?: unknown;
  reason?: unknown;
  explanation?: unknown;
  date?: unknown;
  replacementDbIds?: unknown;
  replacementStIds?: unknown;
};

/**
 * SolrConverter.buildEntry: a Solr document as search-core's Entry, written
 * as ContentService's mapper writes it -- the fields in declaration order,
 * then the getter-only `icon` (true when there is an icon name) and
 * `disease` (isDisease again); NON_EMPTY leaves out nulls, empty strings and
 * empty lists, but not false. A document `highlighting` has an entry for
 * takes its name, summation and the rest only from the snippets, so a name
 * with no snippet is none; otherwise the summation is the document's own,
 * replacing the inferred one even when absent. Dates are epoch milliseconds.
 */
export function searchEntry(
  doc: SolrDoc,
  highlighting: SolrAnswer['highlighting'] | null,
  { speciesWide = false } = {}
) {
  const entry: DraftEntry = {
    dbId: solrValue(doc, 'dbId'),
    stId: solrValue(doc, 'stId'),
    id: 'stId' in doc ? solrValue(doc, 'stId') : solrValue(doc, 'dbId'),
    type: solrValue(doc, 'type'),
    exactType: solrValue(doc, 'exactType'),
    isDisease: solrValue(doc, 'isDisease'),
    hasReferenceEntity: solrValue(doc, 'hasReferenceEntity'),
    hasEHLD: solrValue(doc, 'hasEHLD'),
    databaseName: solrValue(doc, 'databaseName'),
    referenceURL: solrValue(doc, 'referenceURL'),
    regulatorId: solrValue(doc, 'regulatorId'),
    regulatedEntityId: solrValue(doc, 'regulatedEntityId'),
    summation: solrValue(doc, 'inferredSummation'),
    authoredPathways: solrValue(doc, 'authoredPathways'),
    authoredReactions: solrValue(doc, 'authoredReactions'),
    reviewedPathways: solrValue(doc, 'reviewedPathways'),
    reviewedReactions: solrValue(doc, 'reviewedReactions'),
    orcidId: solrValue(doc, 'orcidId'),
    species: solrStrings(doc, 'species'),
    compartmentNames: solrStrings(doc, 'compartmentName'),
    compartmentAccession: solrStrings(doc, 'compartmentAccession'),
  };
  // An object's key is the dbId as text, whatever its type.
  const snippets = highlighting?.[String(entry.dbId)];
  if (snippets) {
    const identifiers = snippets['referenceIdentifiers'];
    entry.referenceIdentifier = identifiers?.length
      ? (identifiers.find((snippet) => snippet.includes('highlighting')) ?? identifiers[0])
      : referenceIdentifier(doc);
    for (const field of [
      'stId',
      'name',
      'summation',
      'referenceName',
      'regulator',
      'regulatedEntity',
    ])
      if (snippets[field]?.length) entry[field] = snippets[field][0];
  } else {
    entry.name = solrValue(doc, 'name');
    entry.summation = solrValue(doc, 'summation');
    entry.referenceName = solrValue(doc, 'referenceName');
    entry.regulator = solrValue(doc, 'regulator');
    entry.regulatedEntity = solrValue(doc, 'regulatedEntity');
    entry.referenceIdentifier = referenceIdentifier(doc);
  }
  // SolrConverter.getFireworksResult adds the document's fireworks species.
  if (speciesWide && 'fireworksSpecies' in doc)
    entry.fireworksSpecies = solrStrings(doc, 'fireworksSpecies');
  for (const field of [
    'iconName',
    'iconCuratorName',
    'iconCuratorOrcidId',
    'iconCuratorUrl',
    'iconDesignerName',
    'iconDesignerUrl',
    'iconDesignerOrcidId',
  ])
    entry[field] = solrValue(doc, field);
  entry.iconCategories = solrStrings(doc, 'iconCategories');
  entry.iconReferences = solrStrings(doc, 'iconReferences');
  entry.iconEhlds = solrStrings(doc, 'iconEhlds');
  entry.iconPhysicalEntities = iconPhysicalEntities(doc);
  entry.deleted = solrValue(doc, 'deleted');
  entry.reason = solrValue(doc, 'deletedReason');
  entry.explanation = solrValue(doc, 'explanation');
  const date = solrValue(doc, 'date');
  entry.date = date === undefined || date === null ? date : Date.parse(String(date));
  // getLongListField: each value cast to String -- anything else is Java's
  // ClassCastException -- and read by Long.parseLong, digits of any script
  // and nothing else; written as the long it is, exactly.
  const replaced = doc['replacementDbIds'];
  entry.replacementDbIds = (
    replaced === undefined || replaced === null
      ? []
      : Array.isArray(replaced)
        ? replaced
        : [replaced]
  ).map((id) => {
    const refused = () =>
      Object.assign(new Error(`a replacement dbId that is no long: ${id}`), { unexpected: true });
    if (typeof id !== 'string') throw refused();
    try {
      return JSON.rawJSON(String(javaParseInt(id, 10, 64)));
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) throw refused();
      throw failure;
    }
  });
  entry.replacementStIds = solrStrings(doc, 'replacementStIds');

  const empty = (value: unknown) =>
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length);
  const out: Written & { icon?: true; disease?: unknown } = {};
  for (const field of ENTRY_FIELDS) if (!empty(entry[field])) out[field] = entry[field];
  // isIcon() is iconName != null: an empty name, left out, is still an icon.
  if (entry.iconName !== undefined && entry.iconName !== null) out.icon = true;
  if (!empty(entry.isDisease)) out.disease = entry.isDisease;
  return out;
}

/**
 * Java's ArrayIndexOutOfBoundsException for an array of `length` read at
 * `reads`, in the order Java reads them (search-core's bytecode): the first
 * index past the end is the one named. GlobalExceptionHandler answers it
 * with that message (handleUnclassified), not the NullPointerException's.
 */
function outOfBounds(length: number, reads: number[], raw: string): Error {
  const index = reads.find((at) => at >= length) ?? length;
  return Object.assign(new Error(`${length} parts, read at ${index}: ${raw}`), {
    javaMessage: `Index ${index} out of bounds for length ${length}`,
  });
}

/**
 * The first four parts of `raw` split as Java splits it, or, for fewer,
 * Java's failure reading them in the order `reads` (outOfBounds).
 */
export function fourParts(
  raw: string,
  separator: string,
  reads: number[]
): [string, string, string, string] {
  const parts = javaSplit(raw, separator);
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined)
    throw outOfBounds(parts.length, reads, raw);
  return [a, b, c, d];
}

/** The parts extractRawOccurrence reads, in its order: [0], [2], [3], then [1]. */
export const OCCURRENCE_READS = [0, 2, 3, 1];

/**
 * SolrConverter's extractRawOccurrence: "diagram:inDiagram:occurrences:
 * interactsWith", '#' for none, as a DiagramOccurrencesResult -- each list a
 * HashSet, so written in a java.util.HashMap's order, and left out empty.
 * Fewer than four parts is Java's ArrayIndexOutOfBoundsException.
 */
export function rawOccurrence(raw: string) {
  const line = fourParts(raw, ':', OCCURRENCE_READS);
  const set = (text: string) => {
    if (text === '#') return undefined;
    const map = new JavaHashMap<string, boolean>();
    for (const item of javaSplit(text, ',')) map.set(item, true);
    const keys = [...map.keys()];
    return keys.length ? keys : undefined;
  };
  const result: {
    diagramEntity?: string;
    inDiagram: boolean;
    occurrences?: string[];
    interactsWith?: string[];
  } = { diagramEntity: line[0], inDiagram: line[1].toLowerCase() === 'true' };
  if (result.diagramEntity === '') delete result.diagramEntity;
  const occurrences = set(line[2]);
  if (occurrences) result.occurrences = occurrences;
  const interactsWith = set(line[3]);
  if (interactsWith) result.interactsWith = interactsWith;
  return result;
}

/**
 * A Boolean with a default that converts to null -- given, but blank (not
 * the single empty value, which is the default): Java's code then unboxes
 * it, its NullPointerException.
 */
export function blankBoolean(values: string[], read: { value?: unknown }) {
  return (
    read.value === undefined && values.length > 0 && !(values.length === 1 && values[0] === '')
  );
}

/**
 * SearchController.getReportInformation: the visitor's agent, address --
 * X-Forwarded-For as nginx sends it to Tomcat and here alike, else the
 * connection's -- and the release, for the report service.
 */
export async function reportInformation(request: Request) {
  const forwarded = request.get?.('x-forwarded-for');
  const address = String(request.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  // The release from the cached version, which a report can do without:
  // asked only when a search found nothing, and never its failure.
  let release: string | null = null;
  try {
    const answer = await databaseVersion({ params: {}, query: {} });
    if (answer.status === 200) release = String(answer.body);
  } catch {
    release = null;
  }
  return {
    agent: request.get?.('user-agent') ?? null,
    ip: forwarded === undefined || forwarded === '' ? address : forwarded,
    release,
  };
}

/** A TargetResult's hashCode: Objects.hash(term), 31 more than its term's. */
const targetHash = (term: string) => 31 + JavaHashMap.stringHash(term);

/** Java's String.split(regex) on runs of its whitespace, \s: leading runs leave an empty term. */
function javaWords(text: string) {
  const parts = text.split(/[ \t\n\v\f\r]+/);
  if (parts.length === 1) return parts;
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** search-core's TargetResult: a term, where it was looked for, and whether it is a target. */
export interface TargetResult {
  term: string;
  resource: SolrValue;
  target: boolean;
}

/**
 * SolrConverter.getTargets: each term of the query, and whether Solr's
 * target core -- proteins in Reactome's scope of annotation -- knows it by
 * identifier, accession, gene name or synonym, ignoring case; the resource
 * is the last document's, as Java's loop leaves it. A TargetResult is equal
 * by its term and hashed as Objects.hash(term), so each term once, in that
 * HashSet's order. The query carries the scope's filter, which the target
 * core has no field for: Solr refuses it, Java swallows the error, and only
 * the BOTH scope finds any.
 */
export async function targetsOf(
  query: string,
  scope: string | null,
  signal: AbortSignal | undefined
) {
  let answer: SolrAnswer | null;
  // Neither table has a key for an absent scope.
  const filter = SCOPE_FILTER[scope ?? ''];
  try {
    answer = await solr('/search', [...(filter ? [pair('fq', filter)] : []), ['q', query]], {
      signal,
      core: 'target',
      method: 'GET',
    });
  } catch (caught) {
    const failure = caught as Failure;
    if (failure.busy || signal?.aborted) throw failure;
    return [];
  }
  const docs = answer?.response?.docs ?? [];
  if (docs.length === 0) return [];
  const same = (a: string, b: string) => caseInsensitive(a, b) === 0 && a.length === b.length;
  const targets = new JavaHashMap<string, TargetResult>({ hash: targetHash });
  for (const term of javaWords(query)) {
    let target = false;
    let resource: SolrValue = null;
    for (const doc of docs) {
      resource = solrValue(doc, 'resource') ?? null;
      // getFieldValues(accessions).stream() and identifier.equalsIgnoreCase:
      // a document without either is Java's NullPointerException.
      if (
        doc['accessions'] === undefined ||
        doc['accessions'] === null ||
        typeof solrValue(doc, 'identifier') !== 'string'
      )
        throw Object.assign(new Error('a target without an identifier or accessions'), {
          unexpected: true,
        });
      const names = [
        solrValue(doc, 'identifier'),
        ...solrStrings(doc, 'accessions'),
        ...solrStrings(doc, 'geneNames'),
        ...solrStrings(doc, 'synonyms'),
      ];
      if (names.some((name) => typeof name === 'string' && same(name, term))) target = true;
    }
    if ([...targets.keys()].includes(term)) continue;
    targets.set(term, { term, resource, target });
  }
  return [...targets.entries()].map(([, result]) => result);
}

/**
 * SearchService's doAsyncReport, after a search found nothing: with
 * targets, those that are (or, none being, the original query) to
 * "targets", and the terms that are not to "notfound" -- whose body is
 * still the original query, as Java's is; with none, the query to
 * "notfound". Never awaited.
 */
export function reportNotFound(info: ReportInfo, originalQuery: string, targets: TargetResult[]) {
  if (targets.length === 0) {
    sendReport('notfound', info, { term: originalQuery, resource: '' });
    return;
  }
  // Collectors.toSet(): the targets again, in a new HashSet of their own.
  const again = new JavaHashMap<string, TargetResult>({ hash: targetHash });
  for (const result of targets) if (result.target) again.set(result.term, result);
  const hits = [...again.entries()].map(([, result]) => result);
  sendReport(
    'targets',
    info,
    hits.length
      ? hits.map((result) => ({ term: result.term, resource: result.resource }))
      : { term: originalQuery, resource: '' }
  );
  if (targets.some((result) => !result.target))
    sendReport('notfound', info, { term: originalQuery, resource: '' });
}
