import { effect, type EffectRef } from '@angular/core';
import type { SummaryService } from './summary.service';

/**
 * Clears the summary whenever it was written about some other result.
 *
 * The service is a root singleton, so a summary outlives the panel that asked
 * for it. The first fix (#278) had each panel remember the token it last saw
 * and clear on a change -- which only works while one panel lives through the
 * change. It does not: opening the analysis form hides the details area and
 * destroys the panel, and the next result gets a new one that has seen nothing,
 * so the previous analysis's summary sat above the new results. The comparison
 * is therefore with what the service says it holds, which survives the panel.
 */
export function clearSummaryForOtherResults(
  summary: SummaryService,
  token: () => string
): EffectRef {
  return effect(() => {
    const held = summary.heldFor();
    if (held && held !== token().trim()) summary.clear();
  });
}
