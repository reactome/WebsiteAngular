import { computed, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { ShownSpecies } from '../model/graph/species.model';
import { startAsFresh } from './start-as-fresh';
import './render-navigation';

const human: ShownSpecies = {
  displayName: 'Homo sapiens',
  taxId: '9606',
  dbId: 48887,
  shortName: 'H. sapiens',
  abbreviation: 'HSA',
  schemaClass: 'Species',
};
const mouse: ShownSpecies = {
  displayName: 'Mus musculus',
  taxId: '10090',
  dbId: 48892,
  shortName: 'M. musculus',
  abbreviation: 'MMU',
  schemaClass: 'Species',
};

/** A page that drew a mouse figure last, with the species list loaded or not. */
function heldPage(list: 'loaded' | 'loading' | 'failed') {
  let dismissed = 0;
  const analysis = { dismissLoadFailure: () => void dismissed++ };
  const species = {
    defaultSpecies: human,
    currentSpecies: signal(mouse),
    abbreviationToSpecies: computed(() => {
      if (list === 'failed') throw new Error('the species list could not be loaded');
      return new Map(list === 'loaded' ? [human, mouse].map((s) => [s.abbreviation, s]) : []);
    }),
  };
  return { analysis, species, dismissed: () => dismissed };
}

describe('startAsFresh (spec 018, research R2)', () => {
  it("clears the previous figure's state and exports", () => {
    const page = heldPage('loaded');
    window.__renderState = { ready: true, error: null, build: 'main-OLD.js' };
    window.__renderExport = {
      svg: () => '<svg/>',
      shapes: () => null,
      png: () => Promise.resolve(''),
      jpeg: () => Promise.resolve(''),
      samples: () => [],
      showSample: () => Promise.resolve(),
      frameCanvas: () => Promise.resolve(document.createElement('canvas')),
    };
    startAsFresh(page.analysis, page.species, 'R-HSA-69620');
    expect(window.__renderState).toBeUndefined();
    expect(window.__renderExport).toBeUndefined();
  });

  it("dismisses the previous token's failure", () => {
    const page = heldPage('loaded');
    startAsFresh(page.analysis, page.species, null);
    expect(page.dismissed()).toBe(1);
  });

  it('the genome-wide view without a species is the default species, not the last figure’s', () => {
    const page = heldPage('loaded');
    startAsFresh(page.analysis, page.species, null);
    expect(page.species.currentSpecies()).toBe(human);
  });

  it('a pathway is the species its id names', () => {
    const page = heldPage('loaded');
    page.species.currentSpecies.set(human);
    startAsFresh(page.analysis, page.species, 'R-MMU-69620');
    expect(page.species.currentSpecies()).toBe(mouse);
  });

  it('a pathway whose species is not listed is the default', () => {
    const page = heldPage('loaded');
    startAsFresh(page.analysis, page.species, 'R-XYZ-1');
    expect(page.species.currentSpecies()).toBe(human);
  });

  it('with no list, loading or failed, the default, as on a fresh page', () => {
    for (const list of ['loading', 'failed'] as const) {
      const page = heldPage(list);
      startAsFresh(page.analysis, page.species, 'R-MMU-69620');
      expect(page.species.currentSpecies(), list).toBe(human);
    }
  });
});
