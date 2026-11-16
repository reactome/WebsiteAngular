/**
 * Kept apart from MoleculeTabComponent so that the object tree can read it without importing the
 * tab: the tab renders the tree (through MoleculeGroupComponent), and importing it back from the
 * tree's details made a runtime cycle that left ObjectTreeDetailsComponent undefined in
 * ObjectTreeComponent's imports in some bundles (NG0919 on expanding a protein, chemical or
 * reaction in the curator build).
 */
export enum MoleculeType {
  PROTEIN = 'Protein', //Protein
  CHEMICAL_DRUG = 'ChemicalDrug', // Drugs
  ENTITY = 'Entity', // DRA/RNA
  CHEMICAL = 'Chemical', //Chemical
}
