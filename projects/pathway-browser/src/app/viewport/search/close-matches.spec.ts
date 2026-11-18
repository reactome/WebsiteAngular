import { describe, expect, it } from 'vitest';
import type * as Search from '../../model/search.model';
import { asksForCloseMatches, closeNameMatches } from './close-matches';

const protein = (dbId: string, name: string, referenceName: string): Search.Entry => ({
  dbId,
  id: `R-HSA-${dbId}`,
  stId: `R-HSA-${dbId}`,
  name,
  type: 'Protein',
  exactType: 'ReferenceGeneProduct',
  referenceName,
  hasReferenceEntity: true,
});

// The first answers of /search/fireworks with scope PHYSICAL_ENTITY, Homo
// sapiens, release 98, cut to the fields read.
const variant = [
  protein('1996341', 'p-6Y-EGFR A289T', 'EGFR'),
  protein('1996306', 'EGFR A289T', 'EGFR'),
  protein('8869138', 'p-6Y-EGFR', 'EGFR'),
  protein('1177528', 'p-6Y-EGFR G719A', 'EGFR'),
];
const egfr: Search.Entry[] = [
  protein('9611160', 'EGFR', 'EGFR'),
  protein('179837', 'EGFR', 'EGFR'),
  { dbId: 'P00533-4', id: 'P00533-4', name: 'EGFR', type: 'Interactor', exactType: 'Interactor' },
  {
    dbId: '9946690',
    id: 'R-HSA-9946690',
    name: 'EGFR mRNA',
    type: 'RNA Sequence',
    exactType: 'ReferenceRNASequence',
    hasReferenceEntity: true,
  },
];
const complex: Search.Entry = {
  dbId: '1248702',
  id: 'R-HSA-1248702',
  name: 'EGF:p-6Y-EGFR',
  type: 'Complex',
  exactType: 'Complex',
  hasReferenceEntity: false,
};

describe('close name matches the grouped search leaves out', () => {
  it('finds the entity named as typed, and only it', () => {
    expect(closeNameMatches('p-6Y-EGFR A289T', variant).map((e) => e.dbId)).toEqual(['1996341']);
  });

  it('ignores case, spacing and highlighting', () => {
    expect(closeNameMatches('  P-6y-egfr   a289t ', variant).map((e) => e.dbId)).toEqual([
      '1996341',
    ]);
    const highlighted = protein(
      '1996341',
      '<span class="highlighting" >p-6Y-EGFR</span> A289T',
      'EGFR'
    );
    expect(closeNameMatches('p-6Y-EGFR A289T', [highlighted])).toEqual([highlighted]);
  });

  it('adds nothing for a gene symbol: its group row stands for those', () => {
    expect(closeNameMatches('EGFR', egfr)).toEqual([]);
  });

  it('leaves out what the grouped list shows already, and each entity is listed once', () => {
    expect(closeNameMatches('EGF:p-6Y-EGFR', [complex])).toEqual([]);
    expect(closeNameMatches('p-6Y-EGFR', [variant[2], variant[2]])).toEqual([variant[2]]);
  });

  it('asks only for a query long enough to name an entity', () => {
    expect(asksForCloseMatches('EGFR')).toBe(false);
    expect(asksForCloseMatches(' TP53 ')).toBe(false);
    expect(asksForCloseMatches('p-6Y-EGFR A289T')).toBe(true);
  });
});
