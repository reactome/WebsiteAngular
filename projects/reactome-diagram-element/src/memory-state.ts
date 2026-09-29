import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, of } from 'rxjs';
import {
  createStateValues,
  UrlStateService,
} from '../../pathway-browser/src/app/services/url-state.service';
import { CONTENT_SERVICE } from '../../pathway-browser/src/environments/environment';

/**
 * The Pathway Browser's state, held in memory for one embedded diagram.
 *
 * The browser keeps its state in the address bar, through the Router. On a
 * partner's page that would read and rewrite *their* address -- every select and
 * flag pushing history onto a page that is not ours. This offers the same public
 * surface (the compiler holds it to UrlStateService's, member for member) and
 * touches nothing outside itself.
 */
@Injectable()
export class MemoryState implements Pick<UrlStateService, keyof UrlStateService> {
  private readonly http = inject(HttpClient);

  // The browser's legacy tab names; an embedded diagram has no tabs.
  readonly oldToNewTab = new Map<string | null, string>();
  readonly newToOldTab = new Map<string, string | null>();

  readonly values = createStateValues(this.oldToNewTab);

  readonly select = this.values.select;
  readonly flag = this.values.flag;
  readonly path = this.values.path;
  readonly flagInteractors = this.values.flagInteractors;
  readonly overlay = this.values.overlay;
  readonly analysis = this.values.analysis;
  readonly analysisTab = this.values.analysisTab;
  readonly tab = this.values.tab;
  readonly significance = this.values.significance;
  readonly sample = this.values.sample;
  readonly interactorScore = this.values.interactorScore;
  readonly palette = this.values.palette;
  readonly filterViewMode = this.values.filterViewMode;
  readonly speciesFilter = this.values.speciesFilter;
  readonly resourceFilter = this.values.resourceFilter;
  readonly includeDisease = this.values.includeDisease;
  readonly includeGrouping = this.values.includeGrouping;
  readonly pathwayMinSizeFilter = this.values.pathwayMinSizeFilter;
  readonly pathwayMaxSizeFilter = this.values.pathwayMaxSizeFilter;
  readonly minExpressionFilter = this.values.minExpressionFilter;
  readonly maxExpressionFilter = this.values.maxExpressionFilter;
  readonly fdrFilter = this.values.fdrFilter;
  readonly gsaFilter = this.values.gsaFilter;
  readonly summariseDisease = this.values.summariseDisease;
  readonly example = this.values.example;

  readonly pathwayId = signal<string | undefined>(undefined);
  readonly section = signal<string | null | undefined>(undefined);

  /** Nothing to keep off a history stack: there is none. */
  settle(change: () => void): void {
    change();
  }

  /** A double-click into a sub-pathway: the diagram changes, the page does not. */
  navigateTo(pathwayId: string | null): Promise<boolean> {
    this.pathwayId.set(pathwayId ?? undefined);
    this.select.set(null);
    return Promise.resolve(true);
  }

  async ensureStId(id: string | number): Promise<string> {
    return typeof id === 'number' ? this.dbIdToStId(id) : id;
  }

  async dbIdToStId(dbId: number): Promise<string> {
    return firstValueFrom(
      this.http
        .get(`${CONTENT_SERVICE}/data/query/${dbId}/stId`, { responseType: 'text' })
        .pipe(catchError(() => of(dbId + '')))
    );
  }
}
