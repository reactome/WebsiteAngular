import { describe, expect, it } from 'vitest';
import { ReacfoamService } from './reacfoam.service';
import { EventsHierarchy } from '../model/events-hierarchy.model';

// The content service leaves an empty list out of its answer, so a pathway in
// an analysis without expression values comes back with no `exp` at all
// (spec 012: every recorded eventsHierarchy answer of an overrepresentation
// analysis). An expression filter left set from an earlier analysis treats it
// as having no value, which the filter excludes, as written; it threw on
// `exp[sample]` instead.

/** The service as event2group sees it, with the filters given. */
function service(filters: Record<string, unknown>) {
  const s = Object.create(ReacfoamService.prototype) as ReacfoamService;
  const merged = { gsa: new Set<number>(), ...filters };
  Object.assign(s, {
    species: { currentSpecies: () => ({ abbreviation: 'HSA' }) },
    state: { filterViewMode: () => 'all' },
    analysis: { result: () => ({}), sampleIndex: () => 0 },
    familyColorMap: () => new Map(),
    surfaceColor: '#fff',
    filters: () => merged,
    mergedFilters: () => merged,
  });
  return s;
}

const leaf: EventsHierarchy.Data = {
  stId: 'R-HSA-1',
  name: 'A pathway',
  species: 'Homo sapiens',
  type: 'Pathway',
  diagram: true,
  llp: true,
  totalEntity: 10,
  totalEntityAndInteractors: 10,
  entities: { resource: 'TOTAL', total: 10, found: 2, ratio: 0.1, pValue: 0.01, fdr: 0.02 },
};

describe('the species overview filters', () => {
  it('exclude a pathway without expression values from an expression or GSA filter, not throw', () => {
    for (const filter of [{ minExpression: 1 }, { maxExpression: 1 }, { gsa: new Set([1]) }]) {
      expect(service(filter).event2group(leaf, new Map(), new Map())).toEqual([]);
    }
  });

  it('keep it when no expression filter is set', () => {
    const groups = service({}).event2group(leaf, new Map(), new Map());
    expect(groups.map((g) => g.stId)).toEqual(['R-HSA-1']);
  });
});
