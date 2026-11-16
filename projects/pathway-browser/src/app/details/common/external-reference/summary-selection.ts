/**
 * What "Select summary of entity" selects for a reference: its stable id
 * (`uniprot:P04637`, `chebi:15422`), which the diagram highlights wherever the
 * molecule is drawn and the Molecules tab shows as a summary.
 *
 * Some references have none: the gene and transcript records a protein's
 * reference links to (NCBI Gene, KEGG, OMIM, RefSeq and the like). No diagram
 * draws them, so there is nothing to select, and selecting nothing would only
 * clear what was selected. The button is not offered for them.
 */
export function summarySelection(reference: { stId?: string | null }): string | null {
  return reference.stId || null;
}
