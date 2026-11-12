// @vitest-environment node
//
// The analysis sizes (spec 006 T103a, research D25) over stand-in graph rows:
// what a pathway counts, how its subpathways add in, and which resources
// count. The sizes from the real graph are checked against Java's by
// analysis-sizes-check.ts, every pathway of every species.
import { describe, expect, it } from 'vitest';
import { computeFigures, computeSizes, countedResource } from './analysis-sizes.ts';
import type { SizeInputs } from './analysis-sizes.ts';

/** A top-level pathway with two subpathways, one of them under both. */
const tree: SizeInputs['tree'] = [
  { parent: 'TOP', child: null },
  { parent: 'TOP', child: 'A' },
  { parent: 'TOP', child: 'B' },
  { parent: 'A', child: 'B' },
];

const sizes = (inputs: Partial<SizeInputs>) =>
  Object.fromEntries(computeSizes({ tree, entities: [], targets: [], partners: [], ...inputs }));

describe('analysis sizes', () => {
  it('counts each identifier once per resource, a pathway its subpathways too', () => {
    const got = sizes({
      entities: [
        {
          pathway: 'A',
          ids: [
            ['UniProt', 'P1', []],
            ['ChEBI', '15422', []],
          ],
        },
        // B is under A and under TOP: its identifiers count in both, once.
        {
          pathway: 'B',
          ids: [
            ['UniProt', 'P1', []],
            ['UniProt', 'P2', []],
          ],
        },
      ],
    });
    expect(got).toEqual({
      TOP: { totalEntity: 3, totalEntityAndInteractors: 3 },
      A: { totalEntity: 3, totalEntityAndInteractors: 3 },
      B: { totalEntity: 2, totalEntityAndInteractors: 2 },
    });
  });

  it('gives a pathway with no subpathways, and one with nothing in it, a size', () => {
    expect(Object.keys(sizes({})).sort()).toEqual(['A', 'B', 'TOP']);
    expect(sizes({})['B']).toEqual({ totalEntity: 0, totalEntityAndInteractors: 0 });
  });

  it("adds a target's partners under the target's resource", () => {
    const got = sizes({
      entities: [{ pathway: 'B', ids: [['UniProt', 'P1', []]] }],
      // A target in a resource that does not count brings no partners.
      targets: [
        {
          pathway: 'B',
          ids: [
            ['UniProtKB', 'P1', []],
            ['UCSC', 'U1', []],
          ],
        },
      ],
      // P1 is its own partner, and already counted; Q9 is new.
      partners: [
        { acc: 'P1', partners: ['P1', 'Q9'] },
        { acc: 'U1', partners: ['Z1'] },
      ],
    });
    expect(got['B']).toEqual({ totalEntity: 1, totalEntityAndInteractors: 2 });
    expect(got['TOP']).toEqual({ totalEntity: 1, totalEntityAndInteractors: 2 });
  });

  it('keeps the same identifier in two resources apart', () => {
    const got = sizes({
      entities: [
        {
          pathway: 'A',
          ids: [
            ['UniProt', 'X', []],
            ['ENSEMBL', 'X', []],
          ],
        },
      ],
    });
    expect(got['A']?.totalEntity).toBe(2);
  });

  it('counts only the resources ResourceFactory names, under its equivalences', () => {
    expect(
      [
        'UniProt',
        'UniProtKB',
        'GeneCards',
        'UCSC human',
        'PRO',
        'ChEBI',
        'IUPHAR',
        'NCBI Nucleotide',
      ].map(countedResource)
    ).toEqual([
      'UNIPROT',
      'UNIPROT',
      'UNIPROT',
      'UNIPROT',
      'UNIPROT',
      'CHEBI',
      'IUPHAR',
      'NCBI_NUCLEOTIDE',
    ]);
    expect(['NCBI Protein', 'EMBL', 'COMPOUND', 'PubChem Compound'].map(countedResource)).toEqual([
      'NCBI_PROTEIN',
      'EMBL',
      'COMPOUND',
      'PUBCHEM_COMPOUND',
    ]);
    for (const other of ['Guide to Pharmacology - Ligands', 'UCSC', 'BioGPS Gene', 'Reactome'])
      expect(countedResource(other)).toBeUndefined();
    const got = sizes({
      entities: [
        {
          pathway: 'A',
          ids: [
            ['UCSC', 'P1', []],
            ['UniProt', 'P1', []],
          ],
        },
      ],
    });
    expect(got['A']?.totalEntity).toBe(1);
  });
});

describe('analysis figures, per resource (T103c)', () => {
  // One top-level pathway TOP holding A.
  const tree = [
    { parent: 'TOP', child: 'A' },
    { parent: 'TOP', child: null },
  ];

  it('counts entities, interactors and reactions per resource, and over all or the main ones', () => {
    const { pathways, species } = computeFigures({
      tree,
      entities: [
        {
          pathway: 'A',
          ids: [
            ['UniProt', 'P1', [1, 2]],
            ['ChEBI', '15422', [2]],
            // An auxiliary resource: counted, not importable.
            ['EMBL', 'E1', [3]],
          ],
        },
      ],
      targets: [{ pathway: 'A', ids: [['UniProt', 'P1', [1]]] }],
      partners: [{ acc: 'P1', partners: ['Q9', 'P1'] }],
    });
    const top = pathways.get('TOP');
    expect(Object.fromEntries(top?.resources ?? [])).toEqual({
      UNIPROT: { entities: 1, interactors: 2, entitiesAndInteractors: 2, reactions: 2 },
      CHEBI: { entities: 1, interactors: 0, entitiesAndInteractors: 1, reactions: 1 },
      EMBL: { entities: 1, interactors: 0, entitiesAndInteractors: 1, reactions: 1 },
    });
    // Identifiers summed over resources; reactions one set.
    expect(top?.combined).toEqual({
      entities: 3,
      interactors: 2,
      entitiesAndInteractors: 4,
      reactions: 3,
    });
    expect(top?.importable).toEqual({
      entities: 2,
      interactors: 2,
      entitiesAndInteractors: 3,
      reactions: 2,
    });
    expect(species.combined).toEqual(top?.combined);
  });

  it("counts a target's reactions for every resource an interactor it shares links to", () => {
    // PathwayNode.processInteractor: X interacts with a UniProt target (in
    // reaction 1) and a ChEBI one (in reaction 2), so reaction 1 counts for
    // ChEBI and reaction 2 for UniProt.
    const { pathways } = computeFigures({
      tree,
      entities: [
        {
          pathway: 'A',
          ids: [
            ['UniProt', 'P1', [1]],
            ['ChEBI', '15422', [2]],
          ],
        },
      ],
      targets: [
        {
          pathway: 'A',
          ids: [
            ['UniProt', 'P1', [1]],
            ['ChEBI', '15422', [2]],
          ],
        },
      ],
      partners: [
        { acc: 'P1', partners: ['X'] },
        { acc: '15422', partners: ['X'] },
      ],
    });
    const a = pathways.get('A');
    expect([a?.resources.get('UNIPROT')?.reactions, a?.resources.get('CHEBI')?.reactions]).toEqual([
      2, 2,
    ]);
  });
});
