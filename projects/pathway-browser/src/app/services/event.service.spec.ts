import { describe, expect, it } from 'vitest';
import { resolveSpecies } from './event.service';
import type { PlainTopLevelPathway } from '../model/graph/event/top-level-pathway.model';

// /data/pathways/top/{taxId} writes a pathway's species once, then by dbId (the
// plain form): the tree reads each species as the object the answer wrote.
const human = {
  dbId: 48887,
  displayName: 'Homo sapiens',
  name: ['Homo sapiens'],
  taxId: '9606',
  abbreviation: 'HSA',
  className: 'Species',
  schemaClass: 'Species',
} as const;

const pathway = (
  dbId: number,
  species?: PlainTopLevelPathway['species']
): PlainTopLevelPathway => ({
  dbId,
  displayName: `Pathway ${dbId}`,
  stId: `R-HSA-${dbId}`,
  stIdVersion: `R-HSA-${dbId}.1`,
  name: [`Pathway ${dbId}`],
  releaseDate: '2026-01-01',
  speciesName: 'Homo sapiens',
  hasDiagram: true,
  hasEHLD: false,
  className: 'TopLevelPathway',
  schemaClass: 'TopLevelPathway',
  ...(species ? { species } : {}),
});

describe('resolveSpecies', () => {
  it('reads a species written by dbId as the one the answer wrote whole earlier', () => {
    const [first, second] = resolveSpecies([pathway(1, [{ ...human }]), pathway(2, [48887])]);
    expect(second?.species?.[0]).toBe(first?.species?.[0]);
    expect(second?.species?.[0]?.abbreviation).toBe('HSA');
  });

  it('leaves a pathway without species without', () => {
    const [only] = resolveSpecies([pathway(3)]);
    expect(only && 'species' in only).toBe(false);
  });
});
