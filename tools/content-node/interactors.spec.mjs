// @vitest-environment node
//
// The static interactor endpoints, as far as no database is needed: how each
// answer is written from its rows, the paging parameters, and the checks the
// POST makes before any query. Every expected value was measured against
// Java's /interactors/static on 15 Oct 2026.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  app,
  customInteractionJson,
  interactionWithEntitiesJson,
  interactorJson,
  interactorsJson,
  springIntegerWithDefault,
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

const MDM2 = {
  id: 11148815,
  score: 0.995,
  accession: ['EBI-3892574', 'EBI-34584959'],
  url: 'https://www.ebi.ac.uk/intact/x',
  partners: [
    {
      labels: ['ReferenceGeneProduct', 'ReferenceSequence', 'ReferenceEntity', 'DatabaseObject'],
      identifier: 'Q00987',
      variantIdentifier: null,
      url: 'http://purl.uniprot.org/uniprot/Q00987',
      geneName: ['MDM2', 'other'],
    },
  ],
};

describe("interactorJson, the content service's Interactor", () => {
  it('writes the partner in the field order Java does', () => {
    expect(interactorJson(MDM2)).toBe(
      '{"acc":"Q00987","alias":"MDM2","id":11148815,"evidences":2,"score":0.995,' +
        '"accURL":"http://purl.uniprot.org/uniprot/Q00987","evidencesURL":"https://www.ebi.ac.uk/intact/x"}'
    );
  });

  it("names an isoform by its variant, and writes a whole score as Java's 1.0", () => {
    const isoform = {
      ...MDM2,
      score: 1,
      partners: [
        {
          ...MDM2.partners[0],
          labels: ['ReferenceIsoform', 'ReferenceGeneProduct', 'ReferenceSequence'],
          variantIdentifier: 'Q00987-2',
        },
      ],
    };
    expect(interactorJson(isoform)).toContain('"acc":"Q00987-2"');
    expect(interactorJson(isoform)).toContain('"score":1.0');
  });

  it('leaves out an empty alias, as NON_EMPTY does: no gene name, or a molecule', () => {
    const molecule = {
      ...MDM2,
      partners: [
        {
          labels: ['ReferenceMolecule', 'ReferenceEntity'],
          identifier: '15422',
          url: 'u',
          geneName: ['x'],
        },
      ],
    };
    expect(interactorJson(molecule)).not.toContain('alias');
    const unnamed = { ...MDM2, partners: [{ ...MDM2.partners[0], geneName: [''] }] };
    expect(interactorJson(unnamed)).not.toContain('alias');
  });
});

describe('interactorsJson, the answer around them', () => {
  it('leaves out the list of an entity with none, keeping its count', () => {
    expect(
      interactorsJson([
        ['P38398', [MDM2]],
        ['XYZ', []],
      ])
    ).toBe(
      `{"resource":"static","entities":[{"acc":"P38398","count":1,"interactors":[${interactorJson(MDM2)}]},` +
        '{"acc":"XYZ","count":0}]}'
    );
  });
});

describe('customInteractionJson, graph-core’s CustomInteraction', () => {
  it('writes its columns in field order, leaving out the empty ones', () => {
    expect(
      customInteractionJson({
        dbId: 1,
        score: 0.5,
        evidenceCount: 2,
        identifier: 'Q1',
        databaseName: 'UniProt',
        displayName: 'UniProt:Q1',
        variantIdentifier: null,
        geneName: [],
        url: 'u',
        evidenceURL: 'e',
        speciesName: null,
        entitiesCount: 0,
      })
    ).toBe(
      '{"dbId":1,"identifier":"Q1","score":0.5,"evidenceCount":2,"url":"u","evidenceURL":"e",' +
        '"databaseName":"UniProt","entitiesCount":0,"displayName":"UniProt:Q1"}'
    );
  });
});

describe('interactionWithEntitiesJson', () => {
  it('sorts the entities by name, ignoring case, as String.CASE_INSENSITIVE_ORDER does', () => {
    const written = interactionWithEntitiesJson({
      score: 1,
      accession: 'Q1',
      accessionURL: 'u',
      evidences: null,
      url: null,
      physicalEntity: [
        { dbId: 2, stId: 'R-HSA-2', displayName: 'b', schemaClass: 'Complex' },
        { dbId: 1, stId: null, displayName: 'B_', schemaClass: null },
        { dbId: 3, stId: 'R-HSA-3', displayName: 'A', schemaClass: 'Complex' },
      ],
    });
    // asDouble(0) and asInt(0): never left out. A missing schemaClass is
    // asString()'s "null".
    expect(written).toBe(
      '{"score":1.0,"accession":"Q1","accessionURL":"u","physicalEntity":[' +
        '{"dbId":3,"stId":"R-HSA-3","displayName":"A","schemaClass":"Complex"},' +
        '{"dbId":2,"stId":"R-HSA-2","displayName":"b","schemaClass":"Complex"},' +
        '{"dbId":1,"displayName":"B_","schemaClass":"null"}],"evidences":0}'
    );
  });
});

describe('the entities’ order, as String.CASE_INSENSITIVE_ORDER has it', () => {
  const order = (...names) =>
    JSON.parse(
      interactionWithEntitiesJson({
        physicalEntity: names.map((displayName, dbId) => ({ dbId, displayName, schemaClass: 'X' })),
      })
    ).physicalEntity.map((pe) => pe.displayName);

  it('takes characters whose upper cases match as equal', () => {
    // 'ı' and 'i' are both 'I' upper-cased, so the next character decides.
    expect(order('ib', 'ıa')).toEqual(['ıa', 'ib']);
  });

  it('compares the lower cases of the upper cases: the long s sorts as s', () => {
    expect(order('ſb', 'z', 'sa')).toEqual(['sa', 'ſb', 'z']);
  });

  it("keeps ß, which has no one-character upper case, as Java's Character does", () => {
    // Java orders by the lower cases: 'ß' (U+00DF) after 's'.
    expect(order('ß', 'st')).toEqual(['st', 'ß']);
  });
});

describe('springIntegerWithDefault, an Integer parameter with a default', () => {
  it('takes the default only for none or one empty value', () => {
    expect(springIntegerWithDefault([], -1)).toEqual({ value: -1 });
    expect(springIntegerWithDefault([''], -1)).toEqual({ value: -1 });
  });

  it('reads blank as null, which the service then fails on', () => {
    expect(springIntegerWithDefault([' '], -1)).toEqual({ value: null });
    expect(springIntegerWithDefault(['', ''], -1)).toEqual({ value: null });
  });

  it('reads the first value, hex included, else names the text in a 400', () => {
    expect(springIntegerWithDefault(['1', '2'], -1)).toEqual({ value: 1 });
    expect(springIntegerWithDefault(['0x1'], -1)).toEqual({ value: 1 });
    expect(springIntegerWithDefault(['abc'], -1)).toEqual({
      error:
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; " +
        'nested exception is java.lang.NumberFormatException: For input string: "abc"',
    });
  });
});

describe('the interactor endpoints, before any query', () => {
  const at = (path, init) => fetch(`${base}/ContentService/interactors/static${path}`, init);
  const envelope = async (response) => {
    const body = await response.json();
    return [response.status, body.reason, body.messages];
  };

  it("is the 400 for a page that is no number, and Java's 500 for a blank one", async () => {
    expect((await at('/molecule/P04637/details?page=abc')).status).toBe(400);
    expect(await envelope(await at('/molecule/P04637/details?page=%20'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['Something unexpected happened and the error has been reported.'],
    ]);
  });

  const post = (body, type = 'text/plain') =>
    at('/molecules/details', {
      method: 'POST',
      headers: type ? { 'Content-Type': type } : {},
      body,
    });

  it('checks the content type, then the paging, then the body', async () => {
    expect((await post('P04637', 'application/json')).status).toBe(415);
    const [status, reason, [message]] = await envelope(await post(undefined));
    expect([status, reason]).toEqual([422, 'UNPROCESSABLE_ENTITY']);
    expect(message).toBe(
      'Required request body is missing: public org.reactome.server.service.model.interactors.Interactors org.reactome.server.service.controller.interactors.StaticInteractionsController.getProteinsDetailsByAccs(java.lang.Integer,java.lang.Integer,java.lang.String)'
    );
  });

  it('is a 405 for a GET of the POST', async () => {
    expect((await at('/molecules/details')).status).toBe(405);
  });
});
