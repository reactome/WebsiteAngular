/**
 * The kinds of molecule the molecule tab groups its participants into.
 *
 * Its own module rather than the molecule tab's: the tab's details (the object
 * tree's details, the external references, the structure viewer) read it, and
 * the tab draws those through the object tree, so importing it from the tab made
 * a loop. An enum is a value, so the loop was real at runtime: the details'
 * component was read before it was defined, and expanding a molecule threw
 * NG0919 and drew nothing.
 */
export enum MoleculeType {
  PROTEIN = 'Protein', //Protein
  CHEMICAL_DRUG = 'ChemicalDrug', // Drugs
  ENTITY = 'Entity', // DRA/RNA
  CHEMICAL = 'Chemical', //Chemical
}
