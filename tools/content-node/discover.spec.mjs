// @vitest-environment node
//
// /data/discover/{identifier} -- an event as a schema.org Dataset, for search
// engines -- as DiscoverController builds it with graph-core's SchemaDataSet.
// The builder is tested on its own with invented objects and a stand-in for
// graph-core's lazy loading; the handler with a stand-in graph, for Java's
// errors. Java's answers were measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let rows = [];
const asked = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher) => {
    asked.push(cypher);
    return rows;
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app, schemaDataSet, lazyCollectionQuery } = await import('./service.mjs');

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

  it('describes an event with no summation as the empty string, and omits what it lacks', async () => {
    const bare = {
      schemaClass: 'Reaction',
      properties: { dbId: 1, stId: 'R-HSA-1', displayName: 'r' },
    };
    const json = await schemaDataSet(bare, null, async () => []);
    expect([json.description, json.version, 'creator' in json, 'citation' in json]).toEqual([
      '',
      'null',
      false,
      false,
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

describe("/data/discover/{identifier}: Java's errors", () => {
  it('is a 404 naming the id as given, for one not found', async () => {
    rows = [];
    const response = await fetch(`${base}/ContentService/data/discover/xyz`);
    expect([response.status, (await response.json()).messages]).toEqual([404, ['xyz not found']]);
  });

  it('is a 422 with a null message for an object that is not an event', async () => {
    rows = [
      {
        labels: ['DatabaseObject', 'PhysicalEntity', 'EntityWithAccessionedSequence'],
        props: { dbId: 1 },
        summations: [],
        references: [],
        authored: [],
      },
    ];
    const response = await fetch(`${base}/ContentService/data/discover/R-HSA-199420`);
    expect([response.status, (await response.json()).messages]).toEqual([422, [null]]);
  });

  it("loads an event with graph-core's findByStId: every relationship, both ways, unsorted", async () => {
    rows = [{ labels: ['DatabaseObject', 'Event', 'Pathway'] }];
    asked.length = 0;
    await fetch(`${base}/ContentService/data/discover/R-HSA-1`);
    const load = asked.find((cypher) => /MATCH \(n\)-\[r\]-\(m\)/.test(cypher));
    expect(load).toBeDefined();
    expect(load).not.toMatch(/ORDER BY|OPTIONAL/);
  });
});
