import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { IDG_SERVICE } from '../../../../pathway-browser/src/environments/environment';

/**
 * One of the interaction datasets the IDG portal knows about.
 *
 * `digitalKey` is what requests are keyed by, not `id`: the service takes a list
 * of those integers. `provenance`, `bioSource` and `dataType` are the three axes
 * the 100-odd datasets vary along, and are what a person picks by.
 */
export interface IdgDataset {
  id: string;
  digitalKey: number;
  provenance: string;
  dataType: string;
  bioSource?: string;
  origin?: string;
}

/**
 * A Reactome pathway the searched gene is enriched in, according to one or more
 * interaction datasets.
 *
 * `bottomLevel` marks a pathway with no sub-pathways. The IDG portal filters on
 * it, because a hit on a leaf pathway says something more specific than a hit on
 * "Signal Transduction".
 */
export interface IdgPathway {
  stId: string;
  name: string;
  pVal: number;
  fdr: number;
  bottomLevel: boolean;
}

/**
 * The IDG portal's "what does this protein have to do with Reactome" query.
 *
 * Ported from the Vue app at idg.reactome.org, which talks to the same service.
 * The data behind it is generated separately and aligned to Reactome's graph
 * database; it is expected to move to our own infrastructure eventually, at which
 * point only IDG_SERVICE changes.
 *
 * Two endpoint names are misspelled in the service itself ("realtionships",
 * "Pathays"). They are spelled here exactly as the service expects, because the
 * service is what has to answer.
 */
@Injectable({ providedIn: 'root' })
export class IdgService {
  private http = inject(HttpClient);

  /** Whether the service knows this gene or protein at all. */
  checkTerm(term: string): Observable<boolean> {
    return this.http
      .get<boolean>(`${IDG_SERVICE}/checkTerm/${encodeURIComponent(term)}`)
      .pipe(catchError(() => of(false)));
  }

  /** Every dataset on offer, for the picker. */
  datasets(): Observable<IdgDataset[]> {
    return this.http.get<IdgDataset[]>(`${IDG_SERVICE}/datadesc`);
  }

  /**
   * Pathways enriched for a term across the chosen datasets.
   *
   * `prd` is the p-value cut-off the service applies. Sorted by FDR here rather
   * than relying on the service's order, so the table has a defined starting
   * point.
   */
  enrichedPathways(term: string, dataDescKeys: number[], prd = 0.01): Observable<IdgPathway[]> {
    return this.http
      .post<IdgPathway[]>(`${IDG_SERVICE}/relationships/enrichedSecondaryPathwaysForTerm1`, {
        term,
        dataDescKeys,
        prd,
      })
      .pipe(map((pathways) => [...pathways].sort((a, b) => a.fdr - b.fdr)));
  }
}
