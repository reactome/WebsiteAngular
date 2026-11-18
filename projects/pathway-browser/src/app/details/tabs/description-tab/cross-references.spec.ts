import { describe, expect, it } from 'vitest';
import { crossReferenceSections, isRhea } from './cross-references';

const ref = (databaseName: string, identifier: string) => ({ databaseName, identifier });

// Release 98's cross-references, as the enhanced query gives them.
// R-HSA-1996341, p-6Y-EGFR A289T: its own, and a few of UniProt P00533's 384.
const variantOwn = [ref('Mondo', '0002544'), ref('COSMIC', 'COSV51770322')];
const egfr = [ref('ENSEMBL', 'ENSG00000146648'), ref('PDB', '1IVO'), ref('RefSeq', 'NP_005219.2')];
// R-HSA-880053, a reaction with a Rhea reaction and a Mondo disease.
const reaction = [ref('RHEA', '51194'), ref('Mondo', '0018177')];

describe("the details tab's cross-references", () => {
  it("lists an entity's own, not its reference entity's in their place", () => {
    const sections = crossReferenceSections(variantOwn, egfr);
    expect(sections.listed).toEqual(variantOwn);
    expect(sections.ofReference).toEqual(egfr);
    expect(sections.rhea).toEqual([]);
  });

  it("keeps the reference entity's for an entity with none of its own", () => {
    const sections = crossReferenceSections(undefined, egfr);
    expect(sections.listed).toEqual([]);
    expect(sections.ofReference).toEqual(egfr);
  });

  it.each([
    ['Rhea first', reaction],
    ['Mondo first', [...reaction].reverse()],
  ])(
    "gives Rhea's view only the Rhea reactions, and lists the rest (%s)",
    (_order, crossReference) => {
      const sections = crossReferenceSections(crossReference, undefined);
      expect(sections.rhea).toEqual([ref('RHEA', '51194')]);
      expect(sections.listed).toEqual([ref('Mondo', '0018177')]);
    }
  );

  it('knows Rhea by its database name, however it is cased', () => {
    expect(isRhea(ref('RHEA', '17826'))).toBe(true);
    expect(isRhea(ref('Rhea', '17826'))).toBe(true);
    expect(isRhea(ref('Mondo', '0018177'))).toBe(false);
  });
});
