import { describe, expect, it } from 'vitest';
import { nameAfterIdentifier, nameBeforeIdentifier } from './utils';

// Display names as the participants endpoint gives them (R-HSA-4839726,
// Chromatin organization, release 98).
describe("a molecule's name from its display name", () => {
  it.each([
    ['UniProt:O60341 KDM1A', 'KDM1A'],
    ['ENSEMBL:ENSG00000155011 DKK2', 'DKK2'],
    ['EMBL:X59360 U2 snRNA', 'U2 snRNA'],
    ['EMBL:AF389121 Unknown', 'Unknown'],
    // Disease (R-HSA-1643685): database names with a space in them.
    [
      'NCBI Nucleotide:MN908947.3 SARS coronavirus, complete genome',
      'SARS coronavirus, complete genome',
    ],
    ['NCBI Entrez Gene:13229470 RNA4.9', 'RNA4.9'],
    ['no identifier at all', 'no identifier at all'],
  ])('keeps the whole name after the identifier: %s', (displayName, name) => {
    expect(nameAfterIdentifier(displayName)).toBe(name);
  });

  it.each([
    ['water [ChEBI:15377]', 'water'],
    ['carbon dioxide [ChEBI:16526]', 'carbon dioxide'],
    [
      '1D-myo-inositol 1,4,5,6-tetrakisphosphate(8-) [ChEBI:57627]',
      '1D-myo-inositol 1,4,5,6-tetrakisphosphate(8-)',
    ],
    ['belinostat [Guide to Pharmacology:7496]', 'belinostat'],
    ['panobinostat [Guide to Pharmacology - Ligands:7489]', 'panobinostat'],
    ['[2Fe-2S] cluster [ChEBI:190135]', '[2Fe-2S] cluster'],
    ['no identifier at all', 'no identifier at all'],
  ])('keeps the whole name before the identifier: %s', (displayName, name) => {
    expect(nameBeforeIdentifier(displayName)).toBe(name);
  });
});
