import { describe, expect, it } from 'vitest';
import { defaultResource } from './analysis.service';
import { Analysis } from '../model/analysis.model';

const summary = (...resources: Analysis.Resource[]) => resources.map((resource) => ({ resource }));

// Curators compared the human/mouse species comparison against production and
// found Macroautophagy at 158 entities here and 145 there. Same release, same
// backend numbers: production displays the specific resource and this site was
// displaying the pooled TOTAL. The counts were the visible half; the statistics
// were the important one -- FDR 0.109 under TOTAL against 0.536 under UNIPROT.
describe('the resource shown when the user has not chosen', () => {
  it('picks the one specific resource, as production does', () => {
    // Exactly the summary the human/mouse comparison returns.
    expect(defaultResource(summary('TOTAL', 'UNIPROT'))).toBe('UNIPROT');
  });

  it('stays on TOTAL when there is nothing to prefer', () => {
    expect(defaultResource(summary('TOTAL'))).toBeNull();
    expect(defaultResource([])).toBeNull();
  });

  it('stays on TOTAL when several resources compete', () => {
    // Which one production favours here is not established, and guessing would
    // swap a known difference for an unknown one.
    expect(defaultResource(summary('TOTAL', 'UNIPROT', 'CHEBI'))).toBeNull();
  });

  it('does not depend on TOTAL being present', () => {
    expect(defaultResource(summary('UNIPROT'))).toBe('UNIPROT');
  });
});
