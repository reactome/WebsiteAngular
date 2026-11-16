import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, Observable, of, shareReplay } from 'rxjs';
import { CONTENT_SERVICE, IS_CURATOR } from '../../environments/environment';
import { DatabaseObject } from '../model/graph/database-object.model';
import { Pathway } from '../model/graph/event/pathway.model';
import { isPathway } from './utils';

/**
 * Puts right the hasDiagram flag on pathways fetched from the curation graph.
 *
 * The flag is a stored property that the release pipeline sets, so a pathway
 * that got its diagram during curation reads false until the next release --
 * The CARD8 inflammasome, R-HSA-9995698, did, and every reaction under it
 * opened NLR signaling's diagram instead of its own, its detail page showed no
 * diagram, and the tree tagged it as drawn inside its parent. The curator
 * content service answers /pathway/{id}/hasDiagram from the PathwayDiagram that
 * represents the pathway instead.
 *
 * Only false flags are asked about; a true one is taken at its word. The public
 * content service has no such endpoint and needs none, so outside the curator
 * build this does nothing.
 *
 * Meant to go away once the curation graph keeps the flag itself.
 */
@Injectable({ providedIn: 'root' })
export class HasDiagramService {
  private http = inject(HttpClient);

  /** Answers by stId, shared so concurrent fetches ask only once. */
  private readonly requests = new Map<string, Observable<boolean>>();

  /**
   * Corrects the flag, in place, on whichever of `objects` are pathways
   * reading false, then emits `value` -- the response they came from, so a
   * fetch can pipe through this without changing shape.
   */
  correct<T>(value: T, objects: (DatabaseObject | null | undefined)[]): Observable<T> {
    if (!IS_CURATOR) return of(value);
    const unflagged = objects.filter(
      (o): o is Pathway => !!o && isPathway(o) && !o.hasDiagram && !!o.stId
    );
    if (unflagged.length === 0) return of(value);
    return forkJoin(unflagged.map((pathway) => this.fetch(pathway.stId))).pipe(
      map((answers) => {
        unflagged.forEach((pathway, i) => (pathway.hasDiagram = answers[i] ?? false));
        return value;
      })
    );
  }

  private fetch(stId: string): Observable<boolean> {
    let request = this.requests.get(stId);
    if (!request) {
      request = this.http.get<boolean>(`${CONTENT_SERVICE}/data/pathway/${stId}/hasDiagram`).pipe(
        // No answer leaves the flag as it was, not a diagram that isn't there.
        catchError(() => {
          this.requests.delete(stId);
          return of(false);
        }),
        shareReplay(1)
      );
      this.requests.set(stId, request);
    }
    return request;
  }
}
