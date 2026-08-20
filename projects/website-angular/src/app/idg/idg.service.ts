import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import {
  ANALYSIS_SERVICE,
  IDG_SERVICE,
} from '../../../../pathway-browser/src/environments/environment';

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
/**
 * An analysis token in the form a URL builder can use.
 *
 * The analysis service hands tokens back already percent-encoded ("...%3D"), and
 * anything that then puts one through a router or URLSearchParams encodes it a
 * second time -- "...%253D", a different token to everything downstream. Decoded
 * at this boundary so callers can encode it exactly once. A token contains no
 * literal '%', so a decode that throws means it was not encoded to begin with.
 */
function decodeToken(token: string | undefined) {
  if (!token) return undefined;
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

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
   * Every gene the term interacts with, and how strongly.
   *
   * The score is a predicted functional interaction: a posterior probability
   * between 0 and 1, so its useful range depends on the gene. TANC1's highest is
   * 0.89, which is why a fixed 0.9 threshold returns nothing at all for it.
   */
  interactorScores(term: string): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(
      `${IDG_SERVICE}/relationships/combinedScoreGenesForTerm/${encodeURIComponent(term)}`
    );
  }

  /**
   * Pathways enriched among a term's interactors.
   *
   * Two modes, and the service picks between them by whether datasets are named:
   *
   * - datasets: enrich over the interactors those datasets report. `prd` is
   *   ignored entirely -- TANC1 returns the same 482 pathways at 0.01 and 0.99.
   * - score: no datasets, and `prd` is the functional-interaction score a
   *   predicted interactor has to beat. This is the one that actually filters,
   *   and the reason the first version of this page showed hundreds of rows: it
   *   sent a p-value where the service wanted a score.
   *
   * Sorted by FDR here rather than relying on the service's order, so the table
   * has a defined starting point.
   */
  enrichedPathways(
    term: string,
    { datasets, score }: { datasets?: number[]; score?: number }
  ): Observable<IdgPathway[]> {
    return this.http
      .post<IdgPathway[]>(`${IDG_SERVICE}/relationships/enrichedSecondaryPathwaysForTerm1`, {
        term,
        ...(datasets?.length ? { dataDescKeys: datasets } : {}),
        ...(score === undefined ? {} : { prd: score }),
      })
      .pipe(map((pathways) => [...pathways].sort((a, b) => a.fdr - b.fdr)));
  }

  /**
   * Run a gene list through Reactome's own analysis and return the token.
   *
   * This is what makes the genome-wide overlay possible: the pathway browser
   * colours Reacfoam and the diagrams from an analysis token, so handing it one
   * built from IDG's interactors lights the whole map up with machinery that
   * already exists.
   *
   * It is a different computation from IDG's enrichment -- Reactome's
   * overrepresentation of the interactor list, not IDG's own aligned statistics
   * -- so the page says so where it offers it rather than implying they are the
   * same numbers.
   */
  analyseInteractors(term: string, genes: string[]): Observable<string | undefined> {
    const body = [`#${term} interactors`, ...genes].join('\n');
    return this.http
      .post<{ summary?: { token?: string } }>(
        `${ANALYSIS_SERVICE}/identifiers/projection?interactors=false&pageSize=1&page=1` +
          `&sortBy=ENTITIES_PVALUE&order=ASC&resource=TOTAL&includeDisease=true`,
        body,
        { headers: { 'Content-Type': 'text/plain' } }
      )
      .pipe(map((result) => decodeToken(result.summary?.token)));
  }
}
