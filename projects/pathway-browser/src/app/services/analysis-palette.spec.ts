import { describe, expect, it } from 'vitest';
import chroma from 'chroma-js';
import { TYPE_DEFAULT_PALETTE } from './analysis.service';
import { Analysis } from '../model/analysis.model';

// A PADOG run comes back as GSA_STATISTICS, which had no default palette. The
// lookup carried a `!`, so the miss produced `undefined` instead of an error --
// and every consumer calls `.scale()` on the palette, so the diagram, the event
// hierarchy, the Voronoi view and the results table went blank together. The
// analysis had succeeded; only the colours were missing, and their absence
// threw. Curators reported it as "analysis finished but no results anywhere".
//
// These walk the type list rather than naming types, so the next type the
// backend adds fails a test instead of a render.
describe('default analysis palettes', () => {
  it('covers every analysis type the backend can return', () => {
    const missing = Analysis.TYPES.filter((type) => !TYPE_DEFAULT_PALETTE.has(type));
    expect(missing, 'analysis types with no default palette').toEqual([]);
  });

  it('names palettes that exist', () => {
    // 'ancient' and 'primary' are built by hand in the service; everything else
    // has to be a real chroma palette or the lookup returns undefined again.
    const handBuilt = ['ancient', 'primary'];
    for (const [type, name] of TYPE_DEFAULT_PALETTE) {
      const exists = handBuilt.includes(name) || name in chroma.brewer;
      expect(exists, `${type} maps to "${name}", which is not a known palette`).toBe(true);
    }
  });

  it('maps nothing the backend cannot return', () => {
    const known = Analysis.TYPES as readonly string[];
    const extra = [...TYPE_DEFAULT_PALETTE.keys()].filter((type) => !known.includes(type));
    expect(extra, 'palette entries for types that do not exist').toEqual([]);
  });
});
