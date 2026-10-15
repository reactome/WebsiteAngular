// @vitest-environment node
//
// The domain serialiser, without a database: query results built by hand,
// mapped and written with the real snapshot. Each case is a behaviour of SDN or
// Jackson that Java showed under the diff harness (15 Oct 2026), pinned here so
// a change to domain.mjs that loses it fails without a graph to compare with.
import { describe, expect, it } from 'vitest';
import {
  findByIdParameters,
  javaDouble,
  mapNodes,
  mapResult,
  VIEW,
  writeDomain,
} from './domain.mjs';

const EVENT = [
  'DatabaseObject',
  'Event',
  'ReactionLikeEvent',
  'Reaction',
  'Trackable',
  'Deletable',
];
const COMPLEX = ['DatabaseObject', 'PhysicalEntity', 'Complex', 'Trackable', 'Deletable'];
const PATHWAY = ['DatabaseObject', 'Event', 'Pathway', 'Trackable', 'Deletable'];

const node = (id, labels, props) => ({ id, labels, props: { dbId: id, ...props } });
const rel = (type, start, end, props = {}) => ({ type, start, end, props });
const write = (row, ...options) => JSON.parse(writeDomain(mapResult(row), ...options));

/** A reaction with two inputs and an output; complex 3 is an input and the output. */
const reaction = {
  root: node(1, EVENT, { displayName: 'r', stId: 'R-HSA-1', isInDisease: false }),
  nodes: [
    node(2, COMPLEX, { displayName: 'a' }),
    node(3, COMPLEX, { displayName: 'b' }),
    node(4, COMPLEX, { displayName: 'c' }),
    node(3, COMPLEX, { displayName: 'b' }),
  ],
  relationships: [
    rel('input', 1, 2, { order: 0, stoichiometry: 2 }),
    rel('input', 1, 3, { order: 1, stoichiometry: 1 }),
    rel('output', 1, 4, { order: 0, stoichiometry: 1 }),
    rel('output', 1, 3, { order: 1, stoichiometry: 1 }),
  ],
};

describe('mapResult and writeDomain, as SDN and Jackson load and write an object', () => {
  it("writes the class's properties in Jackson's order, empty ones left out", () => {
    const json = write(reaction);
    expect(Object.keys(json)).toEqual([
      'dbId',
      'displayName',
      'stId',
      'isInDisease',
      'input',
      'output',
      'className',
      'schemaClass',
    ]);
    expect(json.isInDisease).toBe(false);
    expect(json.className).toBe('Reaction');
  });

  it('repeats an input by its stoichiometry, the repeat as a dbId', () => {
    expect(write(reaction).input.map((entry) => entry.dbId ?? entry)).toEqual([2, 2, 3]);
    expect(write(reaction).input[1]).toBe(2);
  });

  it('fills a field in the order its nodes first appear, not by relationship order', () => {
    // 3 is output order 1 but was met among the inputs, so it is the first output.
    expect(write(reaction).output).toEqual([3, expect.objectContaining({ dbId: 4 })]);
  });

  it('orders by every related node, including the ones the query did not return whole', () => {
    // 4 first appears through a relationship no field of a reaction holds,
    // which findByIdQuery leaves out of `nodes` -- but not out of `order`.
    const json = write({ ...reaction, order: [4, 2, 3, 4, 3] });
    expect(json.output.map((entry) => entry.dbId ?? entry)).toEqual([4, 3]);
  });

  it('counts a relationship returned twice once, as SDN does', () => {
    // On two paths, in-depth returns the same relationship twice. `species`
    // is a List, so a second copy would be a second species.
    const species = node(9, ['DatabaseObject', 'Taxon', 'Species'], {
      displayName: 'Homo sapiens',
    });
    const row = {
      ...reaction,
      nodes: [...reaction.nodes, species, species],
      relationships: [
        ...reaction.relationships,
        { ...rel('species', 1, 9), id: 77 },
        { ...rel('species', 1, 9), id: 77 },
      ],
    };
    expect(write(row).species).toEqual([expect.objectContaining({ dbId: 9 })]);
  });

  it('gives a related object the fields that point back at the root, by stoichiometry too', () => {
    // As Java writes reaction 9834076's: an input of two is consumed by it twice.
    expect(write(reaction).input[0].consumedByEvent).toEqual([1, 1]);
    expect(write(reaction).input[2].consumedByEvent).toEqual([1]);
  });

  it('writes JSOG ids and references for ?includeRef=true', () => {
    const json = write(reaction, VIEW.flatten, { jsog: true });
    expect(Object.keys(json)[0]).toBe('@id');
    expect(json['@id']).toBe('1');
    expect(json.input[0]['@id']).toBe('2');
    expect(json.input[1]).toEqual({ '@ref': '2' });
    expect(json.input[0].consumedByEvent).toEqual([{ '@ref': '1' }, { '@ref': '1' }]);
  });

  it('writes the relationships themselves in the nested view', () => {
    const json = write(reaction, VIEW.nested);
    expect(json.input).toBeUndefined();
    expect(json.inputs[0]).toEqual(
      expect.objectContaining({ type: 'input', stoichiometry: 2, order: 0 })
    );
    expect(Object.keys(json.inputs[0])).toEqual(['type', 'stoichiometry', 'order', 'element']);
  });

  it('composes a reaction of its inputs, outputs and wrapped catalysts in nested-aggregated', () => {
    const row = {
      ...reaction,
      nodes: [...reaction.nodes, node(5, ['DatabaseObject', 'CatalystActivity'], {})],
      relationships: [...reaction.relationships, rel('catalystActivity', 1, 5)],
    };
    const json = write(row, VIEW.nestedAggregated);
    expect(json.composedOf.map((entry) => entry.type)).toEqual([
      'input',
      'input',
      'output',
      'output',
      'catalyst',
    ]);
  });

  it('reads a Pathway reached through an interface-typed field as SDN does: TopLevelPathway', () => {
    const row = {
      root: node(10, ['DatabaseObject', 'MetaDatabaseObject', 'UpdateTracker'], {}),
      nodes: [node(11, PATHWAY, { displayName: 'Apoptosis' })],
      relationships: [rel('updatedInstance', 10, 11)],
    };
    expect(write(row).updatedInstance[0].schemaClass).toBe('TopLevelPathway');
    // Through a field typed by a class, the node's own labels decide.
    const direct = {
      root: node(11, PATHWAY, { displayName: 'Apoptosis' }),
      nodes: [],
      relationships: [],
    };
    expect(write(direct).schemaClass).toBe('Pathway');
  });

  it("keeps a constructor's value where the node has none: moleculeType", () => {
    const row = {
      root: node(
        20,
        ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceGeneProduct'],
        {}
      ),
      nodes: [],
      relationships: [],
    };
    expect(write(row).moleculeType).toBe('Protein');
  });

  it('reads a getter whose field is named otherwise: Book.isbn is ISBN', () => {
    const row = {
      root: node(30, ['DatabaseObject', 'Publication', 'Book'], { ISBN: '0-86720-937-2' }),
      nodes: [],
      relationships: [],
    };
    expect(write(row).isbn).toBe('0-86720-937-2');
  });

  it("falls back to GenomeEncodedEntity's class name for an EWAS of another reference", () => {
    const labels = [
      'DatabaseObject',
      'PhysicalEntity',
      'GenomeEncodedEntity',
      'EntityWithAccessionedSequence',
    ];
    const row = {
      root: node(40, labels, { referenceType: 'ReferenceIsoform' }),
      nodes: [],
      relationships: [],
    };
    expect(write(row).className).toBe('Genes and Transcripts');
  });
});

describe('mapNodes, a query that returns nodes alone', () => {
  const book = node(30, ['DatabaseObject', 'Publication', 'Book'], { displayName: 'b' });
  it('writes each node with its properties and no relationships', () => {
    expect(JSON.parse(writeDomain(mapNodes([book])))).toEqual([
      { dbId: 30, displayName: 'b', className: 'Book', schemaClass: 'Book' },
    ]);
  });

  it('maps a node that comes back twice to one object, written the second time as its dbId', () => {
    expect(JSON.parse(writeDomain(mapNodes([book, book])))[1]).toBe(30);
  });
});

describe('findByIdParameters, which related nodes the query returns whole', () => {
  const person = ['DatabaseObject', 'Person'];

  it("keeps the targets of the class's outgoing fields: a person's publications", () => {
    const { keep } = findByIdParameters(person);
    expect(keep.author).toEqual(['Publication']);
    expect(keep.affiliation).toEqual(['Affiliation']);
  });

  it('leaves out what no field can hold: the InstanceEdits a curator authored', () => {
    expect(findByIdParameters(person).keep.author).not.toContain('InstanceEdit');
  });

  it("names an interface target by its label, as an UpdateTracker's", () => {
    const { keep } = findByIdParameters(['DatabaseObject', 'MetaDatabaseObject', 'UpdateTracker']);
    expect(keep.updatedInstance).toEqual(['Trackable']);
  });
});

describe('javaDouble, as Double.toString writes a number', () => {
  for (const [value, text] of [
    [1, '1.0'],
    [0.75, '0.75'],
    [0, '0.0'],
    [0.001, '0.001'],
    [0.0001, '1.0E-4'],
    [0.00012, '1.2E-4'],
    [1234567, '1234567.0'],
    [12345678, '1.2345678E7'],
    [-2.5, '-2.5'],
  ]) {
    it(`writes ${value} as ${text}`, () => expect(javaDouble(value)).toBe(text));
  }
});
