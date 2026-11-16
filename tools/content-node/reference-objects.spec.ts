// @vitest-environment node
//
// /data/referenceMolecules, /data/referenceSequences and their /identifiers
// forms (spec 006 T105) through the service, with a stand-in graph.
// PhysicalEntityController over graph-core's SchemaService.getByClass, whose
// query is kept as written. The objects' properties are those Java wrote for
// them; the expected bodies and messages are Java's, measured 12 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Properties } from './graph.ts';

/** A query's parameters, as the service passes them (skip and limit as Neo4j integers). */
type Params = { skip?: { toNumber(): number }; limit?: { toNumber(): number } };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
/** The rows the stand-in graph answers next. */
let rows: { n: Properties; labels: string[]; id: number }[] = [];

vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params) => {
    asked.push([cypher, params]);
    // Neo4j's refusal of a negative SKIP or LIMIT, as the driver throws it.
    for (const value of [params.skip, params.limit])
      if (value && value.toNumber() < 0)
        throw Object.assign(
          new Error(
            `Invalid input. '${value.toNumber()}' is not a valid value. Must be a non-negative integer.`
          ),
          { code: 'Neo.ClientError.Statement.ArgumentError' }
        );
    return rows;
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');

let base: string;
let server: Server;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = (path: string) => fetch(`${base}/ContentService/data/${path}`);
/** The last query asked, and its skip and limit as numbers. */
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  const [cypher, { skip, limit }] = query;
  return [cypher, skip?.toNumber(), limit?.toNumber()];
};
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];

const MOLECULES = [
  {
    id: 1,
    labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceMolecule'],
    n: {
      dbId: 48427,
      displayName: '(+)-carvone [ChEBI:15399]',
      stId: 'chebi:15399',
      databaseName: 'ChEBI',
      identifier: '15399',
      name: ['(+)-carvone'],
      url: 'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:15399',
      moleculeType: 'Chemical',
      formula: 'C10H14O',
      schemaClass: 'ReferenceMolecule',
    },
  },
  {
    id: 2,
    labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceMolecule'],
    n: {
      dbId: 3296394,
      displayName: '(+)-cis-isohumulone [ChEBI:73236]',
      stId: 'chebi:73236',
      databaseName: 'ChEBI',
      identifier: '73236',
      name: ['(+)-cis-isohumulone'],
      url: 'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:73236',
      moleculeType: 'Chemical',
      formula: 'C21H30O5',
      schemaClass: 'ReferenceMolecule',
    },
  },
];

const SEQUENCES = [
  {
    id: 3,
    labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceDNASequence'],
    n: {
      dbId: 11390959,
      displayName: 'BioGPS Gene:1 A1BG',
      databaseName: 'BioGPS Gene',
      identifier: '1',
      url: 'https://biogps.org/gene/1',
      moleculeType: 'Entity',
      geneName: ['A1BG'],
      schemaClass: 'ReferenceDNASequence',
    },
  },
  {
    id: 4,
    labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceDNASequence'],
    n: {
      dbId: 11420810,
      displayName: 'BioGPS Gene:10 NAT2',
      databaseName: 'BioGPS Gene',
      identifier: '10',
      url: 'https://biogps.org/gene/10',
      moleculeType: 'Entity',
      geneName: ['NAT2', 'AAC2'],
      schemaClass: 'ReferenceDNASequence',
    },
  },
];

/** Java's answers for the two pairs, as written. */
const JAVA = {
  molecules:
    '[{"dbId":48427,"displayName":"(+)-carvone [ChEBI:15399]","stId":"chebi:15399","databaseName":"ChEBI","identifier":"15399","name":["(+)-carvone"],"url":"https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:15399","moleculeType":"Chemical","formula":"C10H14O","className":"ReferenceMolecule","schemaClass":"ReferenceMolecule"},{"dbId":3296394,"displayName":"(+)-cis-isohumulone [ChEBI:73236]","stId":"chebi:73236","databaseName":"ChEBI","identifier":"73236","name":["(+)-cis-isohumulone"],"url":"https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:73236","moleculeType":"Chemical","formula":"C21H30O5","className":"ReferenceMolecule","schemaClass":"ReferenceMolecule"}]',
  sequences:
    '[{"dbId":11390959,"displayName":"BioGPS Gene:1 A1BG","databaseName":"BioGPS Gene","identifier":"1","url":"https://biogps.org/gene/1","moleculeType":"Entity","geneName":["A1BG"],"className":"ReferenceDNASequence","schemaClass":"ReferenceDNASequence"},{"dbId":11420810,"displayName":"BioGPS Gene:10 NAT2","databaseName":"BioGPS Gene","identifier":"10","url":"https://biogps.org/gene/10","moleculeType":"Entity","geneName":["NAT2","AAC2"],"className":"ReferenceDNASequence","schemaClass":"ReferenceDNASequence"}]',
  sequencesWithRef:
    '[{"@id":"1","dbId":11390959,"displayName":"BioGPS Gene:1 A1BG","databaseName":"BioGPS Gene","identifier":"1","url":"https://biogps.org/gene/1","moleculeType":"Entity","geneName":["A1BG"],"className":"ReferenceDNASequence","schemaClass":"ReferenceDNASequence"},{"@id":"2","dbId":11420810,"displayName":"BioGPS Gene:10 NAT2","databaseName":"BioGPS Gene","identifier":"10","url":"https://biogps.org/gene/10","moleculeType":"Entity","geneName":["NAT2","AAC2"],"className":"ReferenceDNASequence","schemaClass":"ReferenceDNASequence"}]',
};

describe('/data/referenceMolecules', () => {
  it('is every molecule, whole, by graph-core getByClass as written', async () => {
    rows = MOLECULES;
    for (const path of ['referenceMolecules', 'referenceMolecules/']) {
      const response = await get(path);
      expect([
        response.status,
        response.headers.get('content-type'),
        await response.text(),
      ]).toEqual([200, 'application/json; charset=utf-8', JAVA.molecules]);
      expect(last()).toEqual([
        'MATCH (n:ReferenceMolecule) RETURN n, labels(n) AS labels, id(n) AS id ORDER BY n.displayName',
        undefined,
        undefined,
      ]);
    }
  });

  it('is a line each: stable id, then database:identifier', async () => {
    rows = MOLECULES;
    const response = await get('referenceMolecules/identifiers?page=x');
    expect([response.status, response.headers.get('content-type'), await response.text()]).toEqual([
      200,
      'text/plain; charset=utf-8',
      'chebi:15399\tChEBI:15399\nchebi:73236\tChEBI:73236',
    ]);
  });
});

describe('/data/referenceSequences', () => {
  it('is one page, skip (page - 1) * offset, limit the offset, uncapped', async () => {
    rows = SEQUENCES;
    const response = await get('referenceSequences?page=3&offset=30000');
    expect([response.status, await response.text()]).toEqual([200, JAVA.sequences]);
    expect(last()).toEqual([
      'MATCH (n:ReferenceSequence) RETURN n, labels(n) AS labels, id(n) AS id ORDER BY n.displayName SKIP $skip LIMIT $limit',
      60000,
      30000,
    ]);
  });

  it("is written in Java's views", async () => {
    rows = SEQUENCES;
    const response = await get('referenceSequences?page=1&offset=2&includeRef=true');
    expect(await response.text()).toBe(JAVA.sequencesWithRef);
  });

  it('is a line each, the stable id a sequence lacks the text "null"', async () => {
    rows = SEQUENCES;
    const response = await get('referenceSequences/identifiers?page=1&offset=2');
    expect([response.status, response.headers.get('content-type'), await response.text()]).toEqual([
      200,
      'text/plain; charset=utf-8',
      'null\tBioGPS Gene:1\nnull\tBioGPS Gene:10',
    ]);
  });

  it('is an empty list, or no line, past the end', async () => {
    rows = [];
    const json = await get('referenceSequences?page=1000&offset=30000');
    expect([json.status, await json.text()]).toEqual([200, '[]']);
    const lines = await get('referenceSequences/identifiers?page=1&offset=0');
    expect([lines.status, await lines.text()]).toEqual([200, '']);
  });

  it("is Java's 400 for a page or offset missing or unreadable, page first", async () => {
    asked.length = 0;
    const required = (name: string, end: string) =>
      `Required request parameter '${name}' for method parameter type Integer ${end}`;
    expect(await messages(await get('referenceSequences'))).toEqual([
      400,
      [required('page', 'is not present')],
    ]);
    expect(await messages(await get('referenceSequences/identifiers?page=1'))).toEqual([
      400,
      [required('offset', 'is not present')],
    ]);
    expect(await messages(await get('referenceSequences?page=&offset=2'))).toEqual([
      400,
      [required('page', 'is present but converted to null')],
    ]);
    expect(await messages(await get('referenceSequences?page=x&offset=y'))).toEqual([
      400,
      [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; nested exception is java.lang.NumberFormatException: For input string: \"x\"",
      ],
    ]);
    expect(asked).toEqual([]);
  });

  it("is Neo4j's refusal of a negative skip or limit, Java's 500", async () => {
    rows = SEQUENCES;
    const refusal = (value: number) => {
      const message = `Invalid input. '${value}' is not a valid value. Must be a non-negative integer.`;
      return `${message}; Error code 'Neo.ClientError.Statement.ArgumentError'; nested exception is org.neo4j.driver.exceptions.ClientException: ${message}`;
    };
    expect(await messages(await get('referenceSequences?page=0&offset=3'))).toEqual([
      500,
      [refusal(-3)],
    ]);
    expect(await messages(await get('referenceSequences/identifiers?page=1&offset=-1'))).toEqual([
      500,
      [refusal(-1)],
    ]);
    // (99999 - 1) * 30000 in Java's int arithmetic.
    expect(await messages(await get('referenceSequences?page=99999&offset=30000'))).toEqual([
      500,
      [refusal(-1295027296)],
    ]);
  });
});
