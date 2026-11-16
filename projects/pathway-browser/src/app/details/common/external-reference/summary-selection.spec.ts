import { describe, expect, it } from 'vitest';
import { summarySelection } from './summary-selection';

describe('summarySelection', () => {
  it("selects a protein's or chemical's reference by its stable id", () => {
    expect(summarySelection({ stId: 'uniprot:P00001' })).toBe('uniprot:P00001');
    expect(summarySelection({ stId: 'chebi:00001' })).toBe('chebi:00001');
  });

  it('offers nothing for a gene or transcript record with no stable id', () => {
    // As the recordings show NCBI Gene, KEGG, OMIM and RefSeq records: no stId.
    expect(summarySelection({})).toBeNull();
    expect(summarySelection({ stId: undefined })).toBeNull();
    expect(summarySelection({ stId: '' })).toBeNull();
  });
});
