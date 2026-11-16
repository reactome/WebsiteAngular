import { describe, expect, it } from 'vitest';
import { suggestPreview } from './search.component';

// The grey completion behind the search box, and what Enter searches for.
describe('suggestPreview', () => {
  it('completes the text with the chosen suggestion', () => {
    expect(suggestPreview('PTE', ['PTEN', 'PTEN1'], 1)).toBe('PTEN1');
  });

  it('is nothing while no suggestion is chosen', () => {
    expect(suggestPreview('PTE', ['PTEN'], -1)).toBeUndefined();
  });

  // Up from no suggestion chooses the first, with or without one: the
  // preview threw, and Enter did nothing.
  it('is nothing when there is no suggestion where it points', () => {
    expect(suggestPreview('PTE', [], 0)).toBeUndefined();
  });
});
