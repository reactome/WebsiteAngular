// @vitest-environment node
//
// What can be checked without a database.
//
// This service had no handler-level test at all, which is the gap that let a
// `ReferenceError` reach the render service's first request and pass every
// gate. content-node is the one answering beta's traffic, so it had the same
// hole with more at stake.
//
// Most endpoints need Neo4j and belong to `diff.mjs`, which compares them
// against Java. What is checkable here is everything that is *not* a query: the
// endpoint table's own integrity, and the pure functions a declared difference
// is built from.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  app,
  endpoints,
  eventProjection,
  locationsInPathwayBrowser,
  locationsQuery,
  parseHierarchy,
  pathId,
  PathwayBrowserNode,
  pathwayBrowserJson,
  participantJson,
  participantsFrom,
  pathwayJson,
  physicalEntityJson,
  referenceEntityJson,
  resolveId,
  speciesFilter,
  springBoolean,
} from './service.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/health', () => {
  it('answers, which nothing checked before', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.endpoints.length).toBe(endpoints.length);
  });

  it('says which code is running, so a stale container can be spotted', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.build).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('the endpoint table', () => {
  it('addresses every endpoint by the path Java calls it', () => {
    // The table is read by the diff harness and by proxy.conf.js, so a path
    // that does not match Java's is a comparison against the wrong thing.
    for (const endpoint of endpoints) {
      expect(endpoint.path, `${endpoint.path} is a ContentService path`).toMatch(
        /^\/ContentService\//
      );
      expect(typeof endpoint.handler, `${endpoint.path} has a handler`).toBe('function');
    }
  });

  it('declares differences as patterns, never as loose strings', () => {
    // `differs` entries are tested with `.test`, so a string here would throw
    // at comparison time rather than at load -- during a diff run, which is
    // exactly when the harness needs to be trustworthy.
    for (const endpoint of endpoints) {
      for (const rule of endpoint.differs ?? []) {
        expect(rule, `${endpoint.path} declares a RegExp`).toBeInstanceOf(RegExp);
      }
    }
  });

  it('gives every unordered endpoint a key, and every normalise a function', () => {
    for (const endpoint of endpoints) {
      if ('unordered' in endpoint) expect(typeof endpoint.unordered).toBe('function');
      if ('normalise' in endpoint) expect(typeof endpoint.normalise).toBe('function');
    }
  });
});

describe("the person lists' declared difference", () => {
  const person = endpoints.find((e) => e.path.endsWith('/authoredReactions'));

  it('keeps the first occurrence and drops later ones', () => {
    // Java returns an event once per authorship edit. The page asks what a
    // person authored, not when they edited it, so the event belongs once --
    // and first-occurrence in Java's descending order means the row that stays
    // is the one that was already there, in the position it was already in.
    const java = [
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 1, dateTime: '2013-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ];
    expect(person.normalise(java)).toEqual([
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ]);
  });

  it('leaves a list with no duplicates exactly as it was', () => {
    const java = [{ dbId: 1 }, { dbId: 2 }, { dbId: 3 }];
    expect(person.normalise(java)).toEqual(java);
  });

  it('is declared, so the harness reports it rather than hiding it', () => {
    expect(person.differs?.length, 'the normalisation is declared').toBeGreaterThan(0);
  });
});

describe('the species lists', () => {
  const paths = endpoints.map((e) => e.path);

  it('serves both, on the paths Java uses', () => {
    expect(paths).toContain('/ContentService/data/species/main');
    expect(paths).toContain('/ContentService/data/species/all');
  });

  it('serves them as two entries rather than one taking a flag', () => {
    // The two differ in order as well as contents -- `main` pins Homo sapiens
    // first, `all` is plain alphabetical including human in its place -- and a
    // single handler with a boolean is how one of those silently acquires the
    // other's sort. Both orders are proven against Java by `diff.mjs`, which
    // needs a database and so cannot run here; what this can hold is that they
    // stayed separate.
    const species = endpoints.filter((e) => e.path.includes('/data/species/'));
    expect(species).toHaveLength(2);
    expect(species[0].handler).not.toBe(species[1].handler);
  });
});

describe('what /health says about staleness', () => {
  /**
   * Caches live for the life of the process by agreement: updating the database
   * includes restarting this service. The previous version of that reasoning
   * was an inference — "a release restarts the service", true of Java's WAR and
   * not of a container with `restart: unless-stopped` — so the rule is now the
   * rule, and this is what makes a missed restart visible.
   *
   * It matters because the release number keys the bucket paths for diagrams,
   * figures and icons: a process holding the previous one sends all of those to
   * the wrong prefix, and nothing else about the response looks wrong.
   */
  it('reports the release it is serving', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toHaveProperty('release');
  });

  it('still answers when the graph cannot be reached', async () => {
    // No credentials in this suite, so the version handler throws. A health
    // check that failed on that would be reporting the database's health under
    // the name of the process's.
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});

describe('cross-origin reads', () => {
  // Java answers every ContentService request with Access-Control-Allow-Origin:
  // *, and pages on other sites rely on it -- the embeddable diagram (spec 009)
  // reads the species list from a partner's page. The ported endpoints matched
  // Java byte for byte and still broke it, by leaving the header out: the
  // browser refused the answer before anyone saw the body.
  const path = '/ContentService/data/species/main';

  it('allows any origin to read an answer, a failure included', async () => {
    const response = await fetch(`${base}${path}`, { headers: { Origin: 'https://example.org' } });
    // No database here, so this is the error path: a partner's page has to be
    // able to read that it failed, as well as what it got.
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a preflight the way Java does', async () => {
    const response = await fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.org',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('covers every ported endpoint', async () => {
    // In parallel: with no database here, each one takes a while to fail.
    const origins = await Promise.all(
      endpoints.map(async (endpoint) => {
        const url = `${base}${endpoint.path.replace(/\{(\w+)\}/g, 'R-HSA-69620')}`;
        const response = await fetch(url, { headers: { Origin: 'https://example.org' } });
        await response.arrayBuffer();
        return [endpoint.path, response.headers.get('access-control-allow-origin')];
      })
    );
    expect(origins.filter(([, origin]) => origin !== '*')).toEqual([]);
  }, 30_000);
});

describe('resolveId, as graph-core reads an id', () => {
  // Each form measured against Java's /data/query/{id}/stId, 13 Oct 2026.
  const cases = [
    ['70486', 'n.dbId = toInteger($id)', '70486'],
    ['0070486', 'n.dbId = toInteger($id)', '0070486'],
    ['70486.3', 'n.dbId = toInteger($id)', '70486'],
    ['R-HSA-70486', 'n.stId = $id', 'R-HSA-70486'],
    ['R-HSA-70486.4', 'n.stId = $id', 'R-HSA-70486'],
    [' R-HSA-70486 ', 'n.stId = $id', 'R-HSA-70486'],
    ['REACT_1081.3', 'n.oldStId = $id', 'REACT_1081'],
    // A reference id keeps its dot: only ids without ':' are cut.
    ['UniProt:P04637.2', 'n.stId = $id', 'UniProt:P04637.2'],
    ['Rfoo', 'n.stId = $id', 'Rfoo'],
    // Java's trim takes every character up to U+0020, control characters too,
    ['\u000170486\u001f', 'n.dbId = toInteger($id)', '70486'],
    // and its isNumeric and parseLong take any script's digits.
    ['\u0667\u0660\u0664\u0668\u0666', 'n.dbId = toInteger($id)', '70486'],
    ['\uff17\uff10\uff14\uff18\uff16', 'n.dbId = toInteger($id)', '70486'],
  ];
  for (const [raw, where, id] of cases) {
    it(`reads ${JSON.stringify(raw)} as Java does`, () => {
      expect(resolveId(raw)).toEqual({ where, params: { id } });
    });
  }

  it('reads digits from outside the BMP as Java does: not a number', () => {
    // Java tests each UTF-16 unit; a surrogate pair is never a digit to it.
    expect(resolveId('\u{1D7CF}\u{1D7CF}\u{1D7D1}').where).toBe('false');
  });

  it('matches nothing for an id Java would not find, lower case included', () => {
    // Java's trim leaves a no-break space or a line separator in place.
    for (const raw of ['abc', 'r-hsa-70486', '', '\u00a070486', '\u202870486']) {
      expect(resolveId(raw).where).toBe('false');
    }
  });
});

describe('pathId, the id as Spring hands it to a controller', () => {
  it('drops what follows a semicolon, as Spring does before matching', () => {
    expect(pathId('70486;x')).toBe('70486');
    expect(pathId('R-HSA-70486;jsessionid=1;a=b')).toBe('R-HSA-70486');
  });

  it('keeps an encoded semicolon, which Spring decodes only after', () => {
    expect(pathId('R-HSA-70486%3Bx')).toBe('R-HSA-70486;x');
  });

  it('decodes the rest, spaces included', () => {
    expect(pathId('%20R-HSA-70486%20')).toBe(' R-HSA-70486 ');
  });
});

describe("eventProjection, graph-core's EventProjection as Java writes it", () => {
  // A reaction's node as the graph holds it; Java's answer for R-HSA-5672965,
  // 13 Oct 2026, is the expected value.
  const reaction = {
    schemaClass: 'Reaction',
    isInferred: false,
    category: 'transition',
    stIdVersion: 'R-HSA-5672965.4',
    releaseDate: '2015-06-17',
    displayName: 'RAS GEFs promote RAS nucleotide exchange',
    speciesName: 'Homo sapiens',
    stId: 'R-HSA-5672965',
    name: ['RAS GEFs promote RAS nucleotide exchange'],
    dbId: 5672965,
    isInDisease: false,
    // Not part of the projection: never written.
    isChimeric: false,
  };

  it("writes Java's keys in Java's order", () => {
    expect(JSON.stringify(eventProjection(reaction))).toBe(
      '{"dbId":5672965,"displayName":"RAS GEFs promote RAS nucleotide exchange",' +
        '"stId":"R-HSA-5672965","name":["RAS GEFs promote RAS nucleotide exchange"],' +
        '"stIdVersion":"R-HSA-5672965.4","schemaClass":"Reaction","speciesName":"Homo sapiens",' +
        '"releaseDate":"2015-06-17","hasDiagram":false,"hasEHLD":false,"diagramWidth":0,' +
        '"diagramHeight":0,"category":"transition","inferred":false,"inDisease":false}'
    );
  });

  it('puts isCanonical and definition with the field-backed properties, before inferred', () => {
    const keys = Object.keys(eventProjection({ ...reaction, isCanonical: 'x', definition: 'y' }));
    expect(keys.slice(-5)).toEqual([
      'category',
      'isCanonical',
      'definition',
      'inferred',
      'inDisease',
    ]);
  });

  it('defaults the flags and the diagram size as the projection does', () => {
    expect(eventProjection({ dbId: 1 })).toEqual({
      dbId: 1,
      hasDiagram: false,
      hasEHLD: false,
      diagramWidth: 0,
      diagramHeight: 0,
      inferred: false,
      inDisease: false,
    });
  });
});

describe('pathwayJson, a Pathway as graph-core serialises it', () => {
  // Java's answer for R-HSA-162582 under /data/pathways/low/entity, 14 Oct 2026.
  const node = {
    dbId: 162582,
    oldStId: 'REACT_111102',
    displayName: 'Signal Transduction',
    stId: 'R-HSA-162582',
    stIdVersion: 'R-HSA-162582.13',
    isInDisease: false,
    isInferred: false,
    maxDepth: 13,
    name: ['Signal Transduction', 'Signaling Pathways'],
    releaseDate: '2011-09-20',
    releaseStatus: 'UPDATED',
    speciesName: 'Homo sapiens',
    hasDiagram: true,
    hasEHLD: true,
    diagramWidth: 631,
    diagramHeight: 589,
    lastUpdatedDate: '2023-06-07',
    schemaClass: 'TopLevelPathway',
  };

  it("writes Java's keys in Java's order, and not the ones it leaves out", () => {
    expect(JSON.stringify(pathwayJson(node))).toBe(
      '{"dbId":162582,"displayName":"Signal Transduction","stId":"R-HSA-162582",' +
        '"stIdVersion":"R-HSA-162582.13","isInDisease":false,"isInferred":false,"maxDepth":13,' +
        '"name":["Signal Transduction","Signaling Pathways"],"releaseDate":"2011-09-20",' +
        '"releaseStatus":"UPDATED","speciesName":"Homo sapiens","hasDiagram":true,"hasEHLD":true,' +
        '"lastUpdatedDate":"2023-06-07","schemaClass":"TopLevelPathway","className":"TopLevelPathway"}'
    );
  });

  it('writes isCanonical where Java declares it, and defaults hasEHLD to false', () => {
    const withoutEhld = { ...node };
    delete withoutEhld.hasEHLD;
    const keys = Object.keys(pathwayJson({ ...withoutEhld, isCanonical: 'true' }));
    expect(keys.slice(keys.indexOf('hasDiagram'), keys.indexOf('hasDiagram') + 4)).toEqual([
      'hasDiagram',
      'hasEHLD',
      'isCanonical',
      'lastUpdatedDate',
    ]);
    expect(pathwayJson(withoutEhld).hasEHLD).toBe(false);
  });

  it('puts a definition after stIdVersion, and a doi after speciesName', () => {
    const keys = Object.keys(pathwayJson({ ...node, definition: 'd', doi: '10.3180/x' }));
    expect(keys.slice(3, 5)).toEqual(['stIdVersion', 'definition']);
    expect(keys.slice(keys.indexOf('speciesName'), keys.indexOf('speciesName') + 2)).toEqual([
      'speciesName',
      'doi',
    ]);
  });
});

describe('speciesFilter, the species parameter as graph-core reads it', () => {
  // SpeciesService.getSpecies: digits are a taxId, then a dbId; anything else
  // a name, matched against Species.name after collapsing runs of '_' and ' '
  // and capitalising the first letter only. Absent or empty: no filter.
  it('filters by nothing when there is no species', () => {
    expect(speciesFilter(undefined)).toEqual({ kind: 'none' });
    expect(speciesFilter('')).toEqual({ kind: 'none' });
  });

  it('reads digits as a taxId first, then a dbId', () => {
    expect(speciesFilter('9606')).toEqual({ kind: 'number', value: '9606' });
  });

  it('reads digits from outside the BMP as a name, as Java does', () => {
    expect(speciesFilter('\u{1D7D2}\u{1D7D6}').kind).toBe('name');
  });

  it('reads anything else as a name, the way Java normalises it', () => {
    expect(speciesFilter('homo_sapiens')).toEqual({ kind: 'name', value: 'Homo sapiens' });
    expect(speciesFilter('HOMO  SAPIENS')).toEqual({ kind: 'name', value: 'Homo sapiens' });
    expect(speciesFilter('mus__musculus')).toEqual({ kind: 'name', value: 'Mus musculus' });
  });
});

describe('referenceEntityJson, a ReferenceEntity as graph-core serialises it', () => {
  // Java's answer for UniProt:P01112 under /participants/R-HSA-5672965/
  // referenceEntities, 14 Oct 2026, keys shortened.
  const labels = ['DatabaseObject', 'ReferenceEntity', 'ReferenceGeneProduct', 'ReferenceSequence'];
  const node = {
    dbId: 62718,
    displayName: 'UniProt:P01112 HRAS',
    stId: 'uniprot:P01112',
    databaseName: 'UniProt',
    identifier: 'P01112',
    name: ['HRAS'],
    otherIdentifier: ['3265'],
    url: 'http://purl.uniprot.org/uniprot/P01112',
    checksum: 'C',
    geneName: ['HRAS', 'HRAS1'],
    isSequenceChanged: false,
    sequenceLength: 189,
    chain: ['chain:1-186'],
    schemaClass: 'ReferenceGeneProduct',
  };

  it("writes Java's keys in Java's order, moleculeType from the class", () => {
    expect(Object.keys(referenceEntityJson(node, labels))).toEqual([
      'dbId',
      'displayName',
      'stId',
      'databaseName',
      'identifier',
      'name',
      'otherIdentifier',
      'url',
      'moleculeType',
      'checksum',
      'geneName',
      'isSequenceChanged',
      'sequenceLength',
      'chain',
      'className',
      'schemaClass',
    ]);
    expect(referenceEntityJson(node, labels).moleculeType).toBe('Protein');
  });

  it('takes the class from the labels, the most specific one, not schemaClass', () => {
    const isoform = [
      'DatabaseObject',
      'ReferenceEntity',
      'ReferenceIsoform',
      'ReferenceGeneProduct',
    ];
    expect(
      referenceEntityJson({ ...node, schemaClass: 'ReferenceIsoform' }, isoform).className
    ).toBe('ReferenceIsoform');
    const dna = ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceDNASequence'];
    const odd = referenceEntityJson({ dbId: 1, schemaClass: '6' }, dna);
    expect([odd.className, odd.moleculeType, odd.schemaClass]).toEqual([
      'ReferenceDNASequence',
      'Entity',
      '6',
    ]);
  });

  it('gives each class the moleculeType its constructor sets, and a group none', () => {
    const type = (leaf) => referenceEntityJson({ dbId: 1 }, ['ReferenceEntity', leaf]).moleculeType;
    expect(type('ReferenceMolecule')).toBe('Chemical');
    expect(type('ReferenceTherapeutic')).toBe('ChemicalDrug');
    expect(type('ReferenceRNASequence')).toBe('Entity');
    expect(type('ReferenceGroup')).toBeUndefined();
  });

  it('leaves out what Java does not write', () => {
    const json = referenceEntityJson({ ...node, trivial: true }, [
      'ReferenceEntity',
      'ReferenceMolecule',
    ]);
    expect('trivial' in json).toBe(false);
  });
});

describe('an answer with no body', () => {
  // Java's controller returns null for an id that is neither a stable id nor a
  // dbId, and Spring sends a 200 with no body and no content type. Reproduced
  // without the database: the id is refused before any query.
  it('is a 200 with nothing in it, and no content type', async () => {
    const response = await fetch(`${base}/ContentService/data/participants/foo/referenceEntities`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-type')).toBeNull();
  });
});

describe('participantJson, graph-core Participant as Java writes it', () => {
  // Java's answer for R-HSA-5672965 under /participants, 14 Oct 2026, one row.
  const row = {
    peDbId: 5672601,
    displayName: 'RAS GEFs [plasma membrane]',
    schemaClass: 'DefinedSet',
    refEntities: [
      {
        icon: 'EntityWithAccessionedSequence',
        displayName: 'UniProt:P29353-2 SHC1',
        url: 'http://purl.uniprot.org/uniprot/P29353-2',
        schemaClass: 'ReferenceIsoform',
        identifier: 'P29353-2',
        stId: 'uniprot:P29353-2',
        dbId: 248232,
      },
    ],
  };

  it("writes Java's keys in Java's order, at both levels", () => {
    expect(JSON.stringify(participantJson(row))).toBe(
      '{"peDbId":5672601,"displayName":"RAS GEFs [plasma membrane]","schemaClass":"DefinedSet",' +
        '"refEntities":[{"dbId":248232,"stId":"uniprot:P29353-2","identifier":"P29353-2",' +
        '"schemaClass":"ReferenceIsoform","displayName":"UniProt:P29353-2 SHC1",' +
        '"icon":"EntityWithAccessionedSequence","url":"http://purl.uniprot.org/uniprot/P29353-2"}]}'
    );
  });

  it('writes a missing reference value as the text "null", as the driver\'s asString does', () => {
    const json = participantJson({ ...row, refEntities: [{ ...row.refEntities[0], url: null }] });
    expect(json.refEntities[0].url).toBe('null');
  });

  it('leaves out a missing participant name or class, as asString(null) does', () => {
    const json = participantJson({ ...row, displayName: null });
    expect('displayName' in json).toBe(false);
  });
});

describe('participantsFrom, the relationships Java follows from the event', () => {
  // Java's two queries differ, and the difference shows: for a Cell, the dbId
  // form reaches its RNA markers and the stable-id form returns [] (checked
  // against Java with R-HSA-9910609 / 9910609, 14 Oct 2026).
  it('follows RNAMarker and proteinMarker for a dbId', () => {
    expect(participantsFrom(true).split('|')).toEqual(
      expect.arrayContaining(['RNAMarker', 'proteinMarker'])
    );
  });

  it('does not for a stable id', () => {
    const relationships = participantsFrom(false).split('|');
    expect(relationships).not.toContain('RNAMarker');
    expect(relationships).not.toContain('proteinMarker');
  });
});

describe('physicalEntityJson, an other form as graph-core serialises it', () => {
  // Java's answers under /entity/{id}/otherForms, 14 Oct 2026.
  const ewas = {
    dbId: 8874327,
    displayName: 'K48polyUb-PTEN [cytosol]',
    stId: 'R-HSA-8874327',
    stIdVersion: 'R-HSA-8874327.2',
    oldStId: 'REACT_1',
    maxDepth: 1,
    name: ['K48polyUb-PTEN'],
    speciesName: 'Homo sapiens',
    endCoordinate: 403,
    referenceType: 'ReferenceGeneProduct',
    startCoordinate: 2,
    isInDisease: false,
    schemaClass: 'EntityWithAccessionedSequence',
  };

  it("writes an EWAS in Java's order, className after the coordinates", () => {
    expect(Object.keys(physicalEntityJson(ewas))).toEqual([
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'maxDepth',
      'name',
      'speciesName',
      'endCoordinate',
      'referenceType',
      'startCoordinate',
      'className',
      'inDisease',
      'schemaClass',
    ]);
  });

  it('names an EWAS by its reference type, as getClassName does', () => {
    const name = (referenceType) => physicalEntityJson({ ...ewas, referenceType }).className;
    expect(name('ReferenceGeneProduct')).toBe('Protein');
    expect(name('ReferenceDNASequence')).toBe('DNA Sequence');
    expect(name('ReferenceRNASequence')).toBe('RNA Sequence');
    expect(name('ReferenceIsoform')).toBe('Genes and Transcripts');
    expect(physicalEntityJson({ ...ewas, referenceType: null }).className).toBe(
      'Genes and Transcripts'
    );
  });

  it('puts definition after stIdVersion and systematicName after speciesName', () => {
    const keys = Object.keys(physicalEntityJson({ ...ewas, definition: 'd', systematicName: 's' }));
    expect(keys.slice(3, 5)).toEqual(['stIdVersion', 'definition']);
    expect(keys[keys.indexOf('speciesName') + 1]).toBe('systematicName');
  });

  it('calls a simple entity a Chemical Compound', () => {
    const se = {
      dbId: 1,
      schemaClass: 'SimpleEntity',
      referenceType: 'ReferenceMolecule',
      isInDisease: false,
    };
    expect(Object.keys(physicalEntityJson(se))).toEqual([
      'dbId',
      'referenceType',
      'className',
      'inDisease',
      'schemaClass',
    ]);
    expect(physicalEntityJson(se).className).toBe('Chemical Compound');
  });

  it('writes a drug with its class name last, after schemaClass', () => {
    const drug = { dbId: 2, name: ['x'], isInDisease: false, schemaClass: 'ChemicalDrug' };
    expect(JSON.stringify(physicalEntityJson(drug))).toBe(
      '{"dbId":2,"name":["x"],"inDisease":false,"schemaClass":"ChemicalDrug","className":"ChemicalDrug"}'
    );
  });

  it('never writes oldStId, which DatabaseObject ignores', () => {
    expect('oldStId' in physicalEntityJson(ewas)).toBe(false);
  });
});

/** A graph-core HierarchyTreeItem row: [stId, displayName, hasDiagram, speciesName, schemaClass, labels, order]. */
const item = (
  stId,
  schemaClass = 'Pathway',
  { diagram = false, order = 0, species = 'Homo sapiens' } = {}
) => [stId, `${stId} name`, diagram, species, schemaClass, ['DatabaseObject'], order];

describe("PathwayBrowserNode children, graph-core's TreeSet", () => {
  const node = (name, { species = 'Homo sapiens', order } = {}) =>
    Object.assign(new PathwayBrowserNode(), { stId: name, name, species, order });

  it('orders by species, then order, then name by UTF-16 unit, as compareTo does', () => {
    const parent = new PathwayBrowserNode();
    for (const child of [
      node('b'),
      node('a', { order: 1 }),
      node('c'),
      node('a', { species: 'Mus musculus' }),
      node('B'),
    ]) {
      parent.addChild(child);
    }
    expect(parent.children.map((c) => `${c.species}/${c.order ?? 0}/${c.name}`)).toEqual([
      'Homo sapiens/0/B',
      'Homo sapiens/0/b',
      'Homo sapiens/0/c',
      'Homo sapiens/1/a',
      'Mus musculus/0/a',
    ]);
  });

  it('keeps the first of two nodes that compare equal, as a TreeSet does', () => {
    const parent = new PathwayBrowserNode();
    const first = node('same');
    parent.addChild(first);
    parent.addChild(node('same'));
    expect(parent.children).toEqual([first]);
    expect(parent.children[0]).toBe(first);
  });

  it('sorts a node with no species before one with a species', () => {
    const parent = new PathwayBrowserNode();
    parent.addChild(node('z'));
    parent.addChild(node('y', { species: null }));
    expect(parent.children.map((c) => c.name)).toEqual(['y', 'z']);
  });
});

describe('parseHierarchy, graph-core HierarchyRepository.parseRaw', () => {
  const root = item('R-HSA-1', 'EntityWithAccessionedSequence');
  root[5] = ['DatabaseObject', 'PhysicalEntity'];

  it('extends the previous path by its last step, and restarts from the root otherwise', () => {
    const tree = parseHierarchy(
      root,
      [
        [item('A')],
        [item('A'), item('B')],
        [item('A'), item('B'), item('C')],
        [item('D')],
        [item('D'), item('B')],
      ],
      true
    );
    expect(tree.children.map((c) => c.stId)).toEqual(['A', 'D']);
    const [a, d] = tree.children;
    // One node per stId: B is shared, reached from A and from D.
    expect(a.children[0]).toBe(d.children[0]);
    expect(a.children[0].children.map((c) => c.stId)).toEqual(['C']);
    expect(a.children[0].parent.map((p) => p.stId)).toEqual(['A', 'D']);
  });

  it('keeps the quirk: a longer path is attached to the previous node, whatever it starts with', () => {
    // Java only compares lengths, so a two-step path after a one-step one hangs
    // its last node off the previous path's end.
    const tree = parseHierarchy(root, [[item('A')], [item('C'), item('E')]], true);
    expect(tree.children.map((c) => c.stId)).toEqual(['A']);
    expect(tree.children[0].children.map((c) => c.stId)).toEqual(['E']);
  });

  it('skips what the browser cannot show, unless asked not to', () => {
    const paths = [
      [item('X', 'Reaction')],
      [item('X', 'Reaction'), item(null, 'CatalystActivity')],
      [item('X', 'Reaction'), item(null, 'CatalystActivity'), item('Y')],
    ];
    const omitted = parseHierarchy(root, paths, true);
    expect(omitted.children[0].children.map((c) => c.stId)).toEqual(['Y']);
    const kept = parseHierarchy(root, paths, false);
    expect(kept.children[0].children.map((c) => c.type)).toEqual(['CatalystActivity']);
  });

  it('gives the root a species only for an event or entity, and a diagram flag only for a pathway', () => {
    expect(parseHierarchy(root, [], true)).toMatchObject({ species: 'Homo sapiens' });
    expect(parseHierarchy(root, [], true).diagram).toBeUndefined();
    const other = item('R-HSA-2', 'ReferenceGeneProduct');
    expect(parseHierarchy(other, [], true).species).toBeUndefined();
    const pathway = item('R-HSA-3', 'TopLevelPathway', { diagram: true });
    pathway[5] = ['DatabaseObject', 'Event', 'Pathway', 'TopLevelPathway'];
    expect(parseHierarchy(pathway, [], true)).toMatchObject({
      diagram: true,
      species: 'Homo sapiens',
    });
  });

  it('reads a missing order and diagram as Java does: 0 and false', () => {
    const tree = parseHierarchy(
      root,
      [[['A', 'A', null, 'Homo sapiens', 'Pathway', [], null]]],
      true
    );
    expect(tree.children[0]).toMatchObject({ order: 0, diagram: false });
  });
});

describe('locationsInPathwayBrowser, PathwayBrowserLocationsUtils', () => {
  const entity = () => {
    const root = item('E', 'EntityWithAccessionedSequence');
    root[5] = ['DatabaseObject', 'PhysicalEntity'];
    return root;
  };

  it('turns the reverse graph into trees from each top-level pathway, with browser urls', () => {
    const rx = item('Rx', 'Reaction');
    const p1 = item('P1', 'Pathway', { diagram: true });
    const t = item('T', 'TopLevelPathway', { diagram: true });
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[rx], [rx, p1], [rx, p1, t]], true)
    );
    expect(JSON.stringify(trees.map(pathwayBrowserJson))).toBe(
      JSON.stringify([
        {
          stId: 'T',
          name: 'T name',
          species: 'Homo sapiens',
          url: '/PathwayBrowser/#/T',
          type: 'TopLevelPathway',
          children: [
            {
              stId: 'P1',
              name: 'P1 name',
              species: 'Homo sapiens',
              url: '/PathwayBrowser/#/P1',
              type: 'Pathway',
              children: [
                {
                  stId: 'Rx',
                  name: 'Rx name',
                  species: 'Homo sapiens',
                  url: '/PathwayBrowser/#/P1&amp;SEL=Rx&amp;PATH=T',
                  type: 'Reaction',
                  children: [
                    {
                      stId: 'E',
                      name: 'E name',
                      species: 'Homo sapiens',
                      url: '/PathwayBrowser/#/P1&amp;SEL=E&amp;PATH=T',
                      type: 'EntityWithAccessionedSequence',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ])
    );
  });

  it('gives a pathway in two places its own address, and the entity the last diagram', () => {
    const p = item('P', 'Pathway');
    const t1 = item('T1', 'TopLevelPathway', { diagram: true });
    const t2 = item('T2', 'TopLevelPathway', { diagram: true });
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[p], [p, t1], [p, t2]], true)
    );
    expect(trees.map((t) => t.stId)).toEqual(['T1', 'T2']);
    expect(trees[0].children[0].url).toBe('/PathwayBrowser/#/P');
    expect(trees[0].children[0].children[0].url).toBe('/PathwayBrowser/#/T1&amp;SEL=E');
    expect(trees[1].children[0].children[0].url).toBe('/PathwayBrowser/#/T2&amp;SEL=E');
  });

  it('drops branches that end anywhere but a top-level pathway', () => {
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[item('C', 'Complex')], [item('P', 'Pathway')]], true)
    );
    expect(trees).toEqual([]);
  });

  it('answers a top-level pathway with itself', () => {
    const t = item('T', 'TopLevelPathway', { diagram: true });
    t[5] = ['DatabaseObject', 'Event', 'Pathway', 'TopLevelPathway'];
    expect(locationsInPathwayBrowser(parseHierarchy(t, [], true)).map(pathwayBrowserJson)).toEqual([
      {
        stId: 'T',
        name: 'T name',
        species: 'Homo sapiens',
        url: '/PathwayBrowser/#/T',
        type: 'TopLevelPathway',
      },
    ]);
  });
});

describe('pathwayBrowserJson, PathwayBrowserNode as Jackson writes it', () => {
  it("writes Java's keys in field order, leaving out what is empty", () => {
    const node = Object.assign(new PathwayBrowserNode(), {
      type: 'Pathway',
      diagram: false,
      stId: 'R-HSA-1',
      name: 'x',
      order: 3,
      unique: true,
    });
    expect(JSON.stringify(pathwayBrowserJson(node))).toBe(
      '{"stId":"R-HSA-1","name":"x","type":"Pathway","diagram":false}'
    );
  });
});

describe('springBoolean, a Boolean request parameter as Spring converts it', () => {
  it('is absent for no value or an empty one', () => {
    expect(springBoolean([])).toEqual({ value: undefined });
    expect(springBoolean([''])).toEqual({ value: undefined });
    expect(springBoolean(['  '])).toEqual({ value: undefined });
  });

  it('accepts true/on/yes/1 and false/off/no/0, any case, trimmed', () => {
    for (const raw of ['true', 'TRUE', 'on', 'Yes', '1', ' true ']) {
      expect(springBoolean([raw])).toEqual({ value: true });
    }
    for (const raw of ['false', 'OFF', 'no', '0']) {
      expect(springBoolean([raw])).toEqual({ value: false });
    }
  });

  it('takes the first of several values', () => {
    expect(springBoolean(['false', 'true'])).toEqual({ value: false });
  });

  it("refuses anything else with Spring's message, the value as sent", () => {
    expect(springBoolean([' foo '])).toEqual({
      error:
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
        'nested exception is java.lang.IllegalArgumentException: Invalid boolean value [ foo ]',
    });
    expect(springBoolean(['\u2028']).error).toMatch(/\[\u2028\]$/);
  });
});

describe('/detail/{id}/locationsInPWB without a database', () => {
  const path = '/ContentService/data/detail/{id}/locationsInPWB';

  it('is served, on the path Java uses', () => {
    expect(endpoints.map((e) => e.path)).toContain(path);
  });

  it("refuses an unreadable boolean with Java's 400, before reading the id", async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/foo/locationsInPWB?directParticipants=true&omitNonDisplayableItems=bar`
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    const body = await response.json();
    expect(body).toMatchObject({ code: 400, reason: 'BAD_REQUEST', targets: null });
    expect(body.messages).toEqual([
      "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
        'nested exception is java.lang.IllegalArgumentException: Invalid boolean value [bar]',
    ]);
    // Java's url leaves the query out.
    expect(body.url).toMatch(/\/ContentService\/data\/detail\/foo\/locationsInPWB$/);
  });

  it("answers a dbId past a long's range with Java's 500, as Long.parseLong fails", async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/99999999999999999999.2/locationsInPWB`
    );
    expect(response.status).toBe(500);
    expect((await response.json()).messages).toEqual(['For input string: "99999999999999999999"']);
  });

  it("answers an id that is neither a stable id nor a dbId with Java's 404", async () => {
    const response = await fetch(`${base}/ContentService/data/detail/foo/locationsInPWB`);
    expect(response.status).toBe(404);
    expect((await response.json()).messages).toEqual(['Reverse sub graph found for id: foo']);
  });
});

describe("locationsQuery, graph-core's locations queries", () => {
  // The paths' order is the answer's, so the match and the expansion must be
  // Java's text exactly (HierarchyRepository, the deployed graph-core jar).
  const all =
    'regulatedBy|regulator|physicalEntity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|activeUnit|catalystActivity|repeatedUnit|hasMember|hasCandidate|hasComponent|input|output|hasEvent|proteinMarker|RNAMarker';
  const direct =
    'regulatedBy|regulator|physicalEntity|catalystActivity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|input|output|hasEvent';
  const cases = [
    [false, false, `MATCH (n:DatabaseObject{stId:$stId}) OPTIONAL MATCH path=(n)<-[:${all}*]-() `],
    [true, false, `MATCH (n:DatabaseObject{dbId:$dbId}) OPTIONAL MATCH path=(n)<-[:${all}*]-() `],
    [
      false,
      true,
      `MATCH (n:DatabaseObject{stId:$stId}) OPTIONAL MATCH path=(n)<-[:${direct}*]-() `,
    ],
    [true, true, `MATCH (n:DatabaseObject{dbId:$dbId}) OPTIONAL MATCH path=(n)<-[:${direct}*]-() `],
  ];
  for (const [byDbId, directParticipants, java] of cases) {
    it(`matches and expands as Java does (dbId ${byDbId}, direct ${directParticipants})`, () => {
      expect(locationsQuery(byDbId, directParticipants).startsWith(java)).toBe(true);
    });
  }
});
