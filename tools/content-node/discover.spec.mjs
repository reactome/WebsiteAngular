// @vitest-environment node
//
// /data/discover/{identifier} -- an event as a schema.org Dataset, for search
// engines -- as DiscoverController builds it with graph-core's SchemaDataSet.
// The builder is tested on its own with invented objects and a stand-in for
// graph-core's lazy loading; the handler with a stand-in graph, for Java's
// errors. Java's answers were measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The stand-in graph answers each query by what it asks for.
let answer = () => [];
const asked = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher, params) => {
    asked.push(cypher);
    return answer(cypher, params);
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app, schemaDataSet } = await import('./service.ts');
const { lazyCollectionQuery } = await import('./objects.ts');

describe('schemaDataSet', () => {
  const event = {
    schemaClass: 'Pathway',
    properties: { dbId: 109581, stId: 'R-HSA-109581', displayName: 'Apoptosis' },
    summations: ['First.', 'Second.'],
    references: [
      { schemaClass: 'LiteratureReference', displayName: 'A paper', pubMedIdentifier: 123 },
      { schemaClass: 'LiteratureReference', displayName: 'No PubMed id' },
      { schemaClass: 'Book', displayName: 'A book', ISBN: '978-0' },
      { schemaClass: 'Book', displayName: 'No ISBN' },
      { schemaClass: 'URL', displayName: 'A page' },
    ],
    // The edits that authored it, in the order the event's own load gives.
    authored: [10, 11],
  };
  // What graph-core's lazy loading finds: each edit's authors (one listed
  // twice: stoichiometry 2), each person's affiliations.
  const related = {
    'author 10': [[{ dbId: 20, firstname: 'Ann', surname: 'Lee', orcidId: '0000-1' }, 2]],
    'author 11': [[{ dbId: 21, surname: 'Roe' }, 1]],
    'affiliation 20': [[{ dbId: 30, displayName: 'An institute' }, 1]],
    'affiliation 21': [],
  };
  const lazy = async (dbId, type) => related[`${type} ${dbId}`] ?? [];

  it("writes graph-core's Dataset, in Jackson's order", async () => {
    const json = await schemaDataSet(event, 97, lazy);
    expect(Object.keys(json)).toEqual([
      'name',
      'description',
      'url',
      'version',
      'keywords',
      'creator',
      'includedInDataCatalog',
      'distribution',
      'citation',
      'license',
      '@context',
      '@type',
    ]);
    expect(json).toMatchObject({
      name: 'Apoptosis',
      description: 'First.',
      url: 'https://reactome.org/PathwayBrowser/#/R-HSA-109581',
      version: '97',
      keywords: ['Pathway'],
      includedInDataCatalog: {
        name: 'Reactome',
        url: 'https://reactome.org',
        '@type': 'DataCatalog',
      },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      '@context': 'http://schema.org/',
      '@type': 'DataSet',
    });
  });

  it('lists every author of every edit, as often as the edit names them, with their affiliations', async () => {
    const { creator } = await schemaDataSet(event, 97, lazy);
    const first = {
      givenName: 'Ann',
      familyName: 'Lee',
      affiliation: [{ name: 'An institute', '@type': 'Organization' }],
      url: 'http://europepmc.org/authors/0000-1',
      '@type': 'Person',
    };
    expect(creator).toEqual([
      first,
      first,
      { familyName: 'Roe', url: 'http://europepmc.org/authors/null', '@type': 'Person' },
    ]);
    expect(Object.keys(creator[0])).toEqual(Object.keys(first));
  });

  it('offers the seven downloads by dbId, and cites each reference that has an address', async () => {
    const { distribution, citation } = await schemaDataSet(event, 97, lazy);
    expect(distribution.map((d) => [d.fileFormat, d.contentUrl])).toEqual([
      ['SBML', 'https://reactome.org/ContentService/exporter/sbml/109581.xml'],
      ['SBGN', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/sbgnExporter/109581'],
      ['BIOPAX2', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level2/109581'],
      ['BIOPAX3', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/109581'],
      ['PDF', 'https://reactome.org/cgi-bin/pdfexporter?DB=gk_current&ID=109581'],
      ['DOCX', 'https://reactome.org/cgi-bin/rtfexporter?DB=gk_current&ID=109581'],
      ['OWL', 'https://reactome.org/cgi-bin/protegeexporter?DB=gk_current&ID=109581'],
    ]);
    expect(Object.keys(distribution[0])).toEqual([
      'contentUrl',
      'fileFormat',
      'encodingFormat',
      '@type',
    ]);
    expect(citation).toEqual(['http://www.ncbi.nlm.nih.gov/pubmed/123', '978-0', 'A page']);
  });

  it('leaves out what NON_EMPTY leaves out: no summation, no creator, no citation', async () => {
    const bare = {
      schemaClass: 'Reaction',
      properties: { dbId: 1, stId: 'R-HSA-1', displayName: 'r' },
    };
    const json = await schemaDataSet(bare, null, async () => []);
    expect(['description' in json, json.version, 'creator' in json, 'citation' in json]).toEqual([
      false,
      'null',
      false,
      false,
    ]);
    // And an empty text or name, as Jackson's NON_EMPTY drops "".
    const blank = await schemaDataSet(
      {
        ...bare,
        properties: { ...bare.properties, displayName: '' },
        summations: [''],
        authored: [1],
      },
      1,
      async (dbId, field) =>
        field === 'author' ? [[{ dbId: 2, firstname: '', surname: 'S' }, 1]] : []
    );
    expect(['name' in blank, 'description' in blank, Object.keys(blank.creator[0])]).toEqual([
      false,
      false,
      ['familyName', 'url', '@type'],
    ]);
  });
});

describe('lazyCollectionQuery', () => {
  it("is graph-core's queryRelationshipTypesByDbId text, by direction", () => {
    expect(lazyCollectionQuery('author', 'INCOMING', 'Person')).toBe(
      'MATCH (a:DatabaseObject{dbId:$dbId})<-[r:author]-(m:Person) RETURN m, r.stoichiometry as n ORDER BY r.order'
    );
    expect(lazyCollectionQuery('affiliation', 'OUTGOING', 'Affiliation')).toBe(
      'MATCH (a:DatabaseObject{dbId:$dbId})-[r:affiliation]->(m:Affiliation) RETURN m, r.stoichiometry as n ORDER BY r.order'
    );
  });
});

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

// A pathway with a summation, a book and one authoring edit, as graph-core's
// findByStId returns it, and the lazy loads behind the edit.
const ROOT = {
  id: 1,
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  props: { dbId: 5, stId: 'R-HSA-5', displayName: 'P', schemaClass: 'Pathway' },
};
const LOADED = {
  root: ROOT,
  nodes: [
    {
      id: 2,
      labels: ['DatabaseObject', 'Summation'],
      props: { dbId: 6, text: 'T', schemaClass: 'Summation' },
    },
    {
      id: 3,
      labels: ['DatabaseObject', 'Publication', 'Book'],
      props: { dbId: 7, ISBN: '978', displayName: 'B', schemaClass: 'Book' },
    },
    {
      id: 4,
      labels: ['DatabaseObject', 'InstanceEdit'],
      props: { dbId: 8, displayName: 'E', schemaClass: 'InstanceEdit' },
    },
  ],
  relationships: [
    { id: 10, type: 'summation', start: 1, end: 2, props: {} },
    { id: 11, type: 'literatureReference', start: 1, end: 3, props: {} },
    { id: 12, type: 'authored', start: 4, end: 1, props: {} },
  ],
};
const graph =
  ({ load = [LOADED] } = {}) =>
  (cypher, params) => {
    // The object's class, and whether it has any relationship, asked first.
    if (/AS related/.test(cypher))
      return [{ labels: (load[0] ?? LOADED).root.labels, related: load.length > 0 }];
    if (/MATCH \(n\)-\[r\]-\(m\)/.test(cypher)) return load;
    // The release as the service reads it: releaseNumber, not another property.
    if (cypher === 'MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1')
      return [{ version: 97 }];
    // The edit's author, with no stoichiometry on the relationship: once.
    if (/<-\[r:author\]-/.test(cypher) && Number(params.dbId) === 8)
      return [{ m: { dbId: 20, surname: 'Roe' }, n: null }];
    return [];
  };

describe('/data/discover/{identifier}', () => {
  it('writes the Dataset of the event graph-core loads, with its lazy loads', async () => {
    answer = graph();
    const response = await fetch(`${base}/ContentService/data/discover/R-HSA-5`);
    expect(await response.json()).toMatchObject({
      name: 'P',
      description: 'T',
      url: 'https://reactome.org/PathwayBrowser/#/R-HSA-5',
      version: '97',
      keywords: ['Pathway'],
      creator: [{ familyName: 'Roe', url: 'http://europepmc.org/authors/null', '@type': 'Person' }],
      citation: ['978'],
    });
  });

  it('is not found when graph-core loads nothing: an object with no relationship, whatever its class', async () => {
    answer = graph({ load: [] });
    const response = await fetch(`${base}/ContentService/data/discover/12345`);
    expect([response.status, (await response.json()).messages]).toEqual([404, ['12345 not found']]);
  });
});

describe("/data/discover/{identifier}: Java's errors", () => {
  it('is a 404 naming the id as given, for one not found', async () => {
    answer = () => [];
    const response = await fetch(`${base}/ContentService/data/discover/xyz`);
    expect([response.status, (await response.json()).messages]).toEqual([404, ['xyz not found']]);
  });

  it('is a 422 with a null message for an object that is not an event', async () => {
    answer = graph({
      load: [
        {
          ...LOADED,
          root: {
            ...ROOT,
            labels: ['DatabaseObject', 'PhysicalEntity', 'EntityWithAccessionedSequence'],
          },
        },
      ],
    });
    const response = await fetch(`${base}/ContentService/data/discover/R-HSA-199420`);
    expect([response.status, (await response.json()).messages]).toEqual([422, [null]]);
  });

  it('never loads what is not found, or not an event: only an event is worth its relationships', async () => {
    const loads = () => asked.filter((cypher) => /MATCH \(n\)-\[r\]-\(m\)/.test(cypher));
    for (const [load, status] of [
      [[], 404],
      [[{ ...LOADED, root: { ...ROOT, labels: ['DatabaseObject', 'Species'] } }], 422],
    ]) {
      answer = graph({ load });
      asked.length = 0;
      expect((await fetch(`${base}/ContentService/data/discover/48887`)).status).toBe(status);
      expect(loads()).toEqual([]);
    }
    answer = graph();
    asked.length = 0;
    expect((await fetch(`${base}/ContentService/data/discover/R-HSA-5`)).status).toBe(200);
    expect(loads()).toHaveLength(1);
  });

  it("loads an event with graph-core's findByStId: every relationship, both ways, unsorted", async () => {
    answer = graph();
    asked.length = 0;
    await fetch(`${base}/ContentService/data/discover/R-HSA-1`);
    const load = asked.find((cypher) => /MATCH \(n\)-\[r\]-\(m\)/.test(cypher));
    expect(load).toBeDefined();
    expect(load).not.toMatch(/ORDER BY|OPTIONAL/);
    // The object by the id asked, and the three columns mapResult reads.
    expect(load?.replace(/\s+/g, ' ')).toBe(
      'MATCH (n:DatabaseObject) WHERE n.stId = $id WITH n LIMIT 1 MATCH (n)-[r]-(m) ' +
        'RETURN {id: id(n), labels: labels(n), props: properties(n)} AS root, ' +
        'COLLECT({id: id(r), type: type(r), start: id(startNode(r)), end: id(endNode(r)), props: properties(r)}) AS relationships, ' +
        'COLLECT({id: id(m), labels: labels(m), props: properties(m)}) AS nodes'
    );
  });
});
