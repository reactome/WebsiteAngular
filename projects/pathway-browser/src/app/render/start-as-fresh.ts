import { Signal, untracked, WritableSignal } from '@angular/core';
import type { ShownSpecies } from '../model/graph/species.model';

/** What of the analysis service a figure's start resets. */
interface AnalysisState {
  dismissLoadFailure(): void;
}

/** What of the species service a figure's start resets. */
interface SpeciesState {
  readonly defaultSpecies: ShownSpecies;
  readonly currentSpecies: WritableSignal<ShownSpecies>;
  readonly abbreviationToSpecies: Signal<Map<string, ShownSpecies>>;
}

/**
 * What a fresh page starts a figure with, for the state that outlives the
 * render component on a held page (spec 018, research R2). Each line is a
 * figure that came out differently from a fresh page's when the page had
 * drawn another first.
 */
export function startAsFresh(
  analysis: AnalysisState,
  species: SpeciesState,
  pathwayId: string | null
): void {
  // The previous figure's, which a caller could read as this one's before
  // this one publishes (audit 2).
  delete window.__renderState;
  delete window.__renderExport;

  // A dead token's failure is kept until another token arrives, so the figure
  // after it, with no token at all, failed with "the analysis result could not
  // be read" (audit 4).
  analysis.dismissLoadFailure();

  // The species is set only by a pathway's id or by `species=`, so a mouse
  // pathway, then the genome-wide view with neither, drew mouse's overview
  // where a fresh page draws human's (audit 3). This is where a fresh page
  // ends up: the species the id names, or the default. A fresh page has no
  // list yet and starts at the default, which the id's species then replaces.
  let named: ShownSpecies | undefined;
  try {
    named = untracked(species.abbreviationToSpecies).get((pathwayId ?? '').substring(2, 5));
  } catch {
    // A list that failed to load throws when read; a fresh page has none either.
  }
  species.currentSpecies.set(named ?? species.defaultSpecies);
}
