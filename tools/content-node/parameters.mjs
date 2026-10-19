/**
 * What each GET endpoint takes, and whether a URL is in its standard form
 * (spec 011). A standard-form URL is labelled cacheable at the edge; any
 * other is answered just the same but never stored. Java answers many
 * spellings of one request -- a padded id, `includeRef=TRUE`, `maxDepth=01`
 * -- and the edge's cache key is the URL, so each spelling stored would be
 * another copy of one answer, without end. Standard form admits one spelling
 * (a few, where the site itself sends them) and nothing Java would refuse.
 *
 * A documented endpoint's query parameters are not restated here: they are
 * read from Java's published description (openapi-snapshot.json), so the two
 * cannot drift. The record adds what that description lacks: the kind of
 * each path variable, the parameters of the endpoints it leaves out, and the
 * endpoints never stored whatever the URL.
 *
 * Only aliases of a successful answer matter. A value Java refuses gets an
 * error status, and errors are never stored, so no range is checked here.
 */
import { readFileSync } from 'node:fs';
import { SCHEMA_CLASSES } from './schema.mjs';

let openapi;
const OPENAPI = () =>
  (openapi ??= JSON.parse(
    readFileSync(new URL('./openapi-snapshot.json', import.meta.url), 'utf8')
  ));

let names;
/** Names from the graph, as written (snapshot-graph-names.mjs). */
const GRAPH_NAMES = () =>
  (names ??= JSON.parse(readFileSync(new URL('./graph-names.json', import.meta.url), 'utf8')));
const DATABASES = () => GRAPH_NAMES().referenceDatabases;

let attributes;
/** Every getter's attribute name, as Java's getProperty is meant to be asked. */
const ATTRIBUTES = () =>
  (attributes ??= new Set(
    JSON.parse(
      readFileSync(new URL('./domain-snapshot.json', import.meta.url), 'utf8')
    ).getterEntries.map(([, getter]) => getter[3].toLowerCase() + getter.slice(4))
  ));

const STABLE_ID = /^R-[A-Z]{3}-[1-9]\d*$/;
const DB_ID = /^[1-9]\d{0,18}$/;
const LONG_MAX = 2n ** 63n - 1n;
const dbId = (text) => DB_ID.test(text) && BigInt(text) <= LONG_MAX;

/**
 * Path variable kinds. Each refuses what Java also answers -- surrounding
 * spaces, percent-encoding, leading zeros, digits from other scripts, a
 * resource written as a regular expression -- since each is another URL for
 * the same answer.
 */
export const PATH_KINDS = {
  // A stable id with up to three version digits (Java drops the version),
  // a dbId, an old REACT_ id, or a `resource:identifier` the Pathway Browser
  // sends for an external entity.
  oid: (text) =>
    /^R-[A-Z]{3}-[1-9]\d*(\.[1-9]\d{0,2})?$/.test(text) ||
    dbId(text) ||
    /^REACT_[1-9]\d*$/.test(text) ||
    /^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text),
  // Search endpoints hand the id to Solr as it came: a version finds nothing.
  stId: (text) => STABLE_ID.test(text),
  stIdOrDbId: (text) => STABLE_ID.test(text) || dbId(text),
  long: dbId,
  taxId: dbId,
  person: (text) => dbId(text) || /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(text),
  className: (text) => Object.hasOwn(SCHEMA_CLASSES, text),
  attribute: (text) => ATTRIBUTES().has(text),
  // /data/complexes matches it as a case-sensitive pattern: another case is
  // another (empty) answer, not this one again. No pattern characters.
  resource: (text) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(text),
  // /data/mapping finds it ignoring case: only the name as the graph has it.
  database: (text) => DATABASES().some((name) => encodeURIComponent(name) === text),
  identifier: (text) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(text),
  // As the icons are numbered: six digits, zero-padded. Solr is asked for
  // the id as it came, so R-ICO-13748 finds nothing where R-ICO-013748 does.
  icon: (text) => /^R-ICO-\d{6}$/.test(text),
  // Never stored whatever it is (`cache` below).
  any: () => true,
};

/**
 * Values that standard form narrows past their declared type, where Java
 * gives one answer to many:
 *
 *  - `species`, a known species' taxId. Java reads a name in any case, `_`
 *    for a space, digits of any script, and a Species dbId as well as a
 *    taxId; on /pathways/low one it cannot find filters nothing, so
 *    `species=1` is the unfiltered answer again.
 *  - `maxDepth`, -1 (no limit) or 1 to 10. Every negative is -1 and 0 is 1,
 *    and a depth past an object's own tree is -1's answer again.
 *  - `attributes`, a list the site asks for. Java joins the names into a
 *    relationship pattern, where an unknown name, a name in another case or
 *    another order matches what the list without it matches.
 */
const VALUE_KINDS = {
  species: (text) => GRAPH_NAMES().speciesTaxIds.includes(text),
  depth: (text) => text === '-1' || /^([1-9]|10)$/.test(text),
  attributes: (text) =>
    ['species,compartment', 'species,compartment,referenceEntity'].includes(text),
};
const TAX_ID = { species: 'species' };
const IN_DEPTH = { maxDepth: 'depth', attributes: 'attributes' };

const bool = (name, extra = {}) => ({
  name,
  in: 'query',
  type: 'boolean',
  default: false,
  ...extra,
});

/**
 * One entry per GET endpoint, keyed by node's path. `java` is the operation
 * in Java's description it answers for; `null` says why there is none and
 * declares the query parameters itself. `cache` marks what is never stored.
 */
export const RECORD = {
  '/ContentService/data/database/version': { java: '/data/database/version' },
  '/ContentService/data/database/name': { java: '/data/database/name' },
  '/ContentService/data/pathways/top/{id}': {
    java: '/data/pathways/top/{species}',
    path: { id: 'taxId' },
  },
  '/ContentService/data/content/toc': { java: '/data/content/toc' },
  '/ContentService/data/content/doi': { java: '/data/content/doi' },
  '/ContentService/data/content/contributors': { java: '/data/content/contributors' },
  '/ContentService/data/person/{id}': { java: '/data/person/{id}', path: { id: 'person' } },
  '/ContentService/data/person/{id}/publications': {
    java: '/data/person/{id}/publications',
    path: { id: 'person' },
  },
  '/ContentService/data/person/{id}/authoredPathways': {
    java: '/data/person/{id}/authoredPathways',
    path: { id: 'person' },
  },
  '/ContentService/data/person/{id}/authoredReactions': {
    java: '/data/person/{id}/authoredReactions',
    path: { id: 'person' },
  },
  '/ContentService/data/person/{id}/reviewedPathways': {
    java: '/data/person/{id}/reviewedPathways',
    path: { id: 'person' },
  },
  '/ContentService/data/person/{id}/reviewedReactions': {
    java: '/data/person/{id}/reviewedReactions',
    path: { id: 'person' },
  },
  '/ContentService/data/person/{id}/{attribute}': {
    java: '/data/person/{id}/{attributeName}',
    path: { id: 'person', attribute: 'attribute' },
  },
  '/ContentService/data/species/main': { java: '/data/species/main' },
  '/ContentService/data/species/all': { java: '/data/species/all' },
  '/ContentService/data/query/enhanced/v2/{id}': {
    java: '/data/query/enhanced/v2/{id}',
    path: { id: 'oid' },
  },
  '/ContentService/data/query/enhanced/{id}': {
    java: '/data/query/enhanced/{id}',
    path: { id: 'oid' },
  },
  '/ContentService/data/query/{id}/stId': {
    java: '/data/query/{id}/{attributeName}',
    attributeOf: true,
    path: { id: 'oid' },
  },
  '/ContentService/data/query/{id}': { java: '/data/query/{id}', path: { id: 'oid' } },
  '/ContentService/data/diseases': { java: '/data/diseases' },
  '/ContentService/data/diseases/doid': { java: '/data/diseases/doid' },
  '/ContentService/data/query/ids/map': {
    java: null,
    why: 'Java maps only POST here; a GET is always its 404, which is never stored.',
    query: [],
  },
  '/ContentService/data/entity/{id}/in-depth': {
    java: '/data/entity/{id}/in-depth',
    path: { id: 'oid' },
    values: IN_DEPTH,
  },
  '/ContentService/data/event/{id}/in-depth': {
    java: '/data/event/{id}/in-depth',
    path: { id: 'oid' },
    values: IN_DEPTH,
  },
  '/ContentService/data/query/{id}/normalPathway': {
    java: '/data/query/{id}/{attributeName}',
    attributeOf: true,
    path: { id: 'oid' },
  },
  '/ContentService/data/query/{id}/{attribute}': {
    java: '/data/query/{id}/{attributeName}',
    path: { id: 'oid', attribute: 'attribute' },
  },
  '/ContentService/data/event/{id}/ancestors': {
    java: '/data/event/{id}/ancestors',
    path: { id: 'oid' },
  },
  '/ContentService/data/pathways/low/entity/{id}': {
    java: '/data/pathways/low/entity/{id}',
    path: { id: 'oid' },
    values: TAX_ID,
  },
  '/ContentService/data/pathways/low/entity/{id}/allForms': {
    java: '/data/pathways/low/entity/{id}/allForms',
    path: { id: 'oid' },
    values: TAX_ID,
  },
  '/ContentService/data/pathways/low/diagram/entity/{id}': {
    java: '/data/pathways/low/diagram/entity/{id}',
    path: { id: 'oid' },
    values: TAX_ID,
  },
  '/ContentService/data/pathways/low/diagram/entity/{id}/allForms': {
    java: '/data/pathways/low/diagram/entity/{id}/allForms',
    path: { id: 'oid' },
    values: TAX_ID,
  },
  '/ContentService/data/participants/{id}/referenceEntities': {
    java: '/data/participants/{id}/referenceEntities',
    path: { id: 'oid' },
  },
  '/ContentService/data/participants/{id}/participatingPhysicalEntities': {
    java: '/data/participants/{id}/participatingPhysicalEntities',
    path: { id: 'oid' },
  },
  '/ContentService/data/participants/{id}': {
    java: '/data/participants/{id}',
    path: { id: 'oid' },
  },
  '/ContentService/data/entity/{id}/otherForms': {
    java: '/data/entity/{id}/otherForms',
    path: { id: 'oid' },
  },
  '/ContentService/data/entity/{id}/componentOf': {
    java: '/data/entity/{id}/componentOf',
    path: { id: 'oid' },
  },
  '/ContentService/data/discover/{id}': {
    java: '/data/discover/{identifier}',
    path: { id: 'oid' },
  },
  '/ContentService/data/mapping/{resource}/{identifier}/reactions': {
    java: '/data/mapping/{resource}/{identifier}/reactions',
    path: { resource: 'database', identifier: 'identifier' },
    values: TAX_ID,
  },
  // GO is asked by its accession, cut to digits whatever letters lead it.
  '/ContentService/data/mapping/{resource}/{identifier}/pathways': {
    java: '/data/mapping/{resource}/{identifier}/pathways',
    path: { resource: 'database', identifier: 'identifier' },
    values: TAX_ID,
    check: ({ resource, identifier }) =>
      resource === 'GO' && !/^GO:\d{7}$/.test(identifier) ? 'path:identifier' : undefined,
  },
  '/ContentService/references/mapping/{identifier}/xrefs': {
    java: '/references/mapping/{identifier}/xrefs',
    path: { identifier: 'identifier' },
  },
  '/ContentService/references/mapping/{identifier}': {
    java: '/references/mapping/{identifier}',
    path: { identifier: 'identifier' },
  },
  '/ContentService/data/pathway/{id}/containedEvents': {
    java: '/data/pathway/{id}/containedEvents',
    path: { id: 'oid' },
  },
  '/ContentService/data/pathway/{id}/containedEvents/{attribute}': {
    java: '/data/pathway/{id}/containedEvents/{attributeName}',
    path: { id: 'oid', attribute: 'attribute' },
  },
  '/ContentService/data/complex/{id}/subunits': {
    java: '/data/complex/{id}/subunits',
    path: { id: 'oid' },
  },
  '/ContentService/data/complexes/{resource}/{identifier}': {
    java: '/data/complexes/{resource}/{identifier}',
    path: { resource: 'resource', identifier: 'identifier' },
  },
  '/ContentService/data/detail/{id}/locationsInPWB': {
    java: null,
    why: 'An undocumented controller (the Pathway Browser’s locations tree).',
    path: { id: 'oid' },
    query: [bool('directParticipants'), bool('omitNonDisplayableItems')],
  },
  '/ContentService/data/schema/{id}/count': {
    java: '/data/schema/{className}/count',
    path: { id: 'className' },
    values: TAX_ID,
  },
  '/ContentService/data/schema/{id}/min': {
    java: '/data/schema/{className}/min',
    path: { id: 'className' },
    values: TAX_ID,
  },
  '/ContentService/data/schema/model': { java: '/data/schema/model' },
  '/ContentService/data/schema/{id}': {
    java: '/data/schema/{className}',
    path: { id: 'className' },
    values: TAX_ID,
  },
  '/ContentService/data/schema/{id}/reference': {
    java: '/data/schema/{className}/reference',
    path: { id: 'className' },
  },
  '/ContentService/data/schema/{id}/attributes': {
    java: '/data/schema/{className}/attributes',
    path: { id: 'className' },
  },
  '/ContentService/data/schema/{id}/referrals': {
    java: '/data/schema/{className}/referrals',
    path: { id: 'className' },
  },
  '/ContentService/data/orthology/{id}/species/{speciesId}': {
    java: '/data/orthology/{id}/species/{speciesId}',
    path: { id: 'oid', speciesId: 'long' },
  },
  '/ContentService/interactors/static/molecule/{id}/details': {
    java: '/interactors/static/molecule/{acc}/details',
    path: { id: 'identifier' },
  },
  '/ContentService/interactors/static/molecule/{id}/summary': {
    java: '/interactors/static/molecule/{acc}/summary',
    path: { id: 'identifier' },
  },
  '/ContentService/interactors/static/molecule/{id}/pathways': {
    java: '/interactors/static/molecule/{acc}/pathways',
    path: { id: 'identifier' },
  },
  // Re-read from an outside registry every five minutes.
  '/ContentService/interactors/psicquic/resources': {
    java: '/interactors/psicquic/resources',
    cache: 'never',
  },
  '/ContentService/interactors/static/molecule/enhanced/{id}/details': {
    java: '/interactors/static/molecule/enhanced/{acc}/details',
    path: { id: 'identifier' },
  },
  '/ContentService/interactors/static/molecule/{id}/withEntities': {
    java: '/interactors/static/molecule/{acc}/withEntities',
    path: { id: 'identifier' },
  },
  // Takes an analysis token: one person's result.
  '/ContentService/exporter/diagram/{id}': {
    java: null,
    why: 'Java documents it as /exporter/diagram/{identifier}.{ext}; never stored at the edge anyway.',
    path: { id: 'any' },
    query: [],
    cache: 'private',
  },
  // Takes an analysis token: one person's result.
  '/ContentService/exporter/fireworks/{id}': {
    java: null,
    why: 'Java documents it as /exporter/fireworks/{species}.{ext}; never stored at the edge anyway.',
    path: { id: 'any' },
    query: [],
    cache: 'private',
  },
  '/ContentService/search/suggest': { java: '/search/suggest' },
  '/ContentService/search/spellcheck': { java: '/search/spellcheck' },
  '/ContentService/search/facet': { java: '/search/facet' },
  '/ContentService/search/facet_query': { java: '/search/facet_query' },
  '/ContentService/search/diagram/summary': {
    java: null,
    why: 'An undocumented controller (the Pathway Browser’s search counts).',
    query: [
      { name: 'query', in: 'query', type: 'string', required: true },
      { name: 'species', in: 'query', type: 'string' },
      { name: 'diagram', in: 'query', type: 'string' },
      {
        name: 'scope',
        in: 'query',
        type: 'string',
        default: 'REFERENCE_ENTITY',
        enum: ['REFERENCE_ENTITY', 'PHYSICAL_ENTITY', 'BOTH'],
      },
      bool('includeInteractors'),
    ],
  },
  '/ContentService/search/diagram/{pathwayId}/flag': {
    java: '/search/diagram/{pathwayId}/flag',
    path: { pathwayId: 'stId' },
  },
  '/ContentService/search/diagram/{diagram}/occurrences/{instance}': {
    java: '/search/diagram/{diagram}/occurrences/{instance}',
    path: { diagram: 'stId', instance: 'stIdOrDbId' },
    // Java binds it and never reads it: any value is the same answer.
    ignored: ['types'],
  },
  '/ContentService/search/diagram/{diagram}': {
    java: '/search/diagram/{diagram}',
    path: { diagram: 'stId' },
  },
  '/ContentService/search/fireworks/flag': { java: '/search/fireworks/flag' },
  '/ContentService/search/pathways/of/{dbId}': {
    java: '/search/pathways/of/{dbId}',
    path: { dbId: 'long' },
  },
  '/ContentService/search/fireworks': { java: '/search/fireworks' },
  '/ContentService/search/query/paginated': { java: '/search/query/paginated' },
  '/ContentService/search/query': { java: '/search/query' },
  // The Europe PMC answers are live, and the site sends today's date to the
  // pathway's, so each day would be another entry for one answer.
  '/ContentService/citation/pathway/{id}': {
    java: null,
    why: 'An undocumented controller; never stored.',
    path: { id: 'any' },
    query: [],
    cache: 'never',
  },
  '/ContentService/citation/static/{id}': {
    java: null,
    why: 'An undocumented controller; never stored.',
    path: { id: 'any' },
    query: [],
    cache: 'never',
  },
  // On a Europe PMC failure this answers an empty 200, which would be kept
  // until the next release's purge.
  '/ContentService/citation/export': {
    java: null,
    why: 'An undocumented controller; never stored.',
    query: [],
    cache: 'never',
  },
  '/ContentService/data/instance/{id}/referrers': {
    java: '/data/instance/{id}/referrers',
    path: { id: 'oid' },
  },
  '/ContentService/search/icon/facet': { java: '/search/icon/facet' },
  '/ContentService/search/icon/query': { java: '/search/icon/query' },
  '/ContentService/search/icon/{identifier}': {
    java: '/search/icon/{identifier}',
    path: { identifier: 'icon' },
  },
};

/** The query parameters an endpoint declares: Java's, or the record's own. */
export function declaredQuery(endpoint) {
  const entry = RECORD[endpoint];
  if (!entry) return [];
  if (entry.java === null) return entry.query;
  return (OPENAPI().paths[entry.java]?.get ?? []).filter(
    (parameter) => parameter.in === 'query' && !entry.ignored?.includes(parameter.name)
  );
}

const INT32 = 2 ** 31;
/** One value, decoded, in the one spelling standard form takes for its type. */
function valid(parameter, value, kind) {
  if (kind) return VALUE_KINDS[kind](value);
  if (parameter.type === 'array')
    return value
      .split(',')
      .every((item) => (parameter.enum ? parameter.enum.includes(item) : plainText(item)));
  if (parameter.enum) return parameter.enum.includes(value);
  if (parameter.type === 'boolean') return value === 'true' || value === 'false';
  if (parameter.type === 'integer') {
    if (!/^(0|-?[1-9]\d*)$/.test(value)) return false;
    const number = Number(value);
    return parameter.format === 'int64'
      ? Number.isSafeInteger(number)
      : number >= -INT32 && number < INT32;
  }
  return plainText(value);
}
const plainText = (text) => text !== '' && text.trim() === text;

/**
 * A value as sent must be one encoding of what it decodes to: the strict
 * one, or Angular's HttpParams, which the site uses and which leaves
 * `@ : $ , ; = ? /` bare. Anything else -- `%31` for 1, `+` for a space --
 * is the same value spelled again.
 */
function encodedOnce(raw, value) {
  const strict = encodeURIComponent(value);
  const angular = strict.replace(/%(40|3A|24|2C|3B|3D|3F|2F)/gi, (escape) =>
    decodeURIComponent(escape)
  );
  return raw === strict || raw === angular;
}

function decode(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

/**
 * Whether `originalUrl` -- the request exactly as sent, never Express's
 * rewritten or decoded form -- is in standard form for `endpoint`, a key of
 * RECORD. `{ ok: true }`, or `{ ok: false, rule }` naming what failed:
 * `form`, `path:<variable>` or `parameter:<name>`.
 */
export function standardForm(endpoint, originalUrl) {
  const entry = RECORD[endpoint];
  if (!entry) return { ok: false, rule: 'form' };
  const at = originalUrl.indexOf('?');
  const path = at === -1 ? originalUrl : originalUrl.slice(0, at);
  const query = at === -1 ? undefined : originalUrl.slice(at + 1);

  const template = endpoint.split('/');
  const segments = path.split('/');
  if (segments.length !== template.length) return { ok: false, rule: 'form' };
  for (const [index, part] of template.entries()) {
    const variable = /^\{([^}]+)\}$/.exec(part)?.[1];
    if (variable === undefined) {
      if (segments[index] !== part) return { ok: false, rule: 'form' };
    } else if (!PATH_KINDS[entry.path?.[variable]]?.(segments[index])) {
      return { ok: false, rule: `path:${variable}` };
    }
  }
  if (entry.check) {
    const values = Object.fromEntries(
      template.flatMap((part, index) => {
        const variable = /^\{([^}]+)\}$/.exec(part)?.[1];
        return variable === undefined ? [] : [[variable, segments[index]]];
      })
    );
    const rule = entry.check(values);
    if (rule) return { ok: false, rule };
  }

  if (query === undefined) return { ok: true };
  const declared = new Map(declaredQuery(endpoint).map((parameter) => [parameter.name, parameter]));
  const seen = new Set();
  const items = new Set();
  for (const pair of query.split('&')) {
    if (pair === '') return { ok: false, rule: 'form' };
    const equals = pair.indexOf('=');
    const rawName = equals === -1 ? pair : pair.slice(0, equals);
    const name = decode(rawName);
    if (name === undefined) return { ok: false, rule: 'form' };
    const parameter = declared.get(name);
    // One spelling of a name: Java's spaced names as the site sends them.
    if (!parameter || rawName !== encodeURIComponent(name))
      return { ok: false, rule: `parameter:${name}` };
    if (seen.has(name) && parameter.type !== 'array')
      return { ok: false, rule: `parameter:${name}` };
    seen.add(name);
    const raw = equals === -1 ? undefined : pair.slice(equals + 1);
    const value = raw === undefined ? undefined : decode(raw);
    if (
      value === undefined ||
      !encodedOnce(raw, value) ||
      !valid(parameter, value, entry.values?.[name])
    )
      return { ok: false, rule: `parameter:${name}` };
    // A list's item given twice is the list given once.
    if (parameter.type === 'array')
      for (const item of value.split(',')) {
        if (items.has(`${name}=${item}`)) return { ok: false, rule: `parameter:${name}` };
        items.add(`${name}=${item}`);
      }
  }
  return { ok: true };
}
