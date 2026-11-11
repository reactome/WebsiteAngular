import { describe, expect, it } from 'vitest';
import { countLocations, opensWhole, withBrowserLinks } from './locations-tree.component';

// As /data/detail/R-HSA-163615/locationsInPWB answers (PKA activation, release
// 98), trimmed to one branch.
const answer = {
  stId: 'R-HSA-162582',
  name: 'Signal Transduction',
  type: 'TopLevelPathway',
  url: '/PathwayBrowser/#/R-HSA-162582',
  children: [
    {
      stId: 'R-HSA-163615',
      name: 'PKA activation',
      type: 'Pathway',
      url: '/PathwayBrowser/#/R-HSA-163615&amp;PATH=R-HSA-111997,R-HSA-111933,R-HSA-111931',
    },
    {
      // Most locations carry two escaped ampersands: a selection and a path
      // (R-HSA-114269's, release 98).
      stId: 'R-HSA-109606',
      name: 'Intrinsic Pathway for Apoptosis',
      type: 'Pathway',
      url: '/PathwayBrowser/#/R-HSA-109606&amp;SEL=R-HSA-114269&amp;PATH=R-HSA-5357801,R-HSA-109581',
    },
  ],
};

describe("the locations tree's links", () => {
  it('can be read by the Pathway Browser: no escaped ampersands, at any depth', () => {
    const tree = withBrowserLinks(answer);
    expect(tree.url).toBe('/PathwayBrowser/#/R-HSA-162582');
    expect(tree.children?.[1]?.url).toBe(
      '/PathwayBrowser/#/R-HSA-109606&SEL=R-HSA-114269&PATH=R-HSA-5357801,R-HSA-109581'
    );
    expect(tree.children?.[0]?.url).toBe(
      '/PathwayBrowser/#/R-HSA-163615&PATH=R-HSA-111997,R-HSA-111933,R-HSA-111931'
    );
  });

  it('leaves a node without children without them', () => {
    expect('children' in withBrowserLinks({ ...answer.children[0]! })).toBe(false);
  });
});

// Spec 023, FR-050: a tree is shown open on a content page when it holds 20
// locations or fewer -- the places, not the path to them.
describe('which Locations trees open by themselves', () => {
  it('counts the places, not the path to them', () => {
    // PKA activation's tree, as release 98 has it: one top-level pathway, two
    // locations at the end of chains of single children.
    const chain = (depth: number, leaf: string): typeof answer =>
      depth === 0
        ? { stId: leaf, name: 'PKA activation', type: 'Pathway', url: '/x' }
        : {
            stId: `R-HSA-${depth}`,
            name: 'step',
            type: 'Pathway',
            url: '/x',
            children: [chain(depth - 1, leaf)],
          };
    const pka = { ...answer, children: [chain(5, 'R-HSA-163615'), chain(11, 'R-HSA-163615')] };
    expect(countLocations(pka)).toBe(2);
    expect(countLocations({ ...answer.children[0]! })).toBe(1);
  });

  it('opens at 20 locations or fewer, and not above', () => {
    // Release 98, Homo sapiens: PKA activation 2, BCL2 16, ATP 2,182.
    expect([2, 16, 20].map(opensWhole)).toEqual([true, true, true]);
    expect([21, 2182].map(opensWhole)).toEqual([false, false]);
  });
});
