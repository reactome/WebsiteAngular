import { inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  UrlStateService,
  urlParam,
} from '../../../../../../pathway-browser/src/app/services/url-state.service';
import { DEFAULT_INTERACTOR_SCORE } from '../../../../../../pathway-browser/src/app/interactors/interactor-threshold';

/**
 * Members of UrlStateService the content pages leave out, each because nothing
 * on them calls it -- their diagram is an image, not cr-diagram. Everything
 * else UrlStateService has, this must have too: the type says so. It was
 * `Partial`, which let navigateTo stay missing while the description panel's
 * "Other Pathways" called it.
 */
type NotOnContentPages =
  | 'settle'
  | 'isFirstNavigation'
  | 'queryParams'
  | 'ensureStId'
  | 'dbIdToStId'
  // The Pathway Browser's viewport reads these to keep old tab names working.
  | 'oldToNewTab'
  | 'newToOldTab';

/** The state the content pages read, for the Pathway Browser components they reuse. */
@Injectable()
export class DetailUrlState implements Omit<UrlStateService, NotOnContentPages> {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /**
   * A content page is not inside a pathway: going to one is opening it in the
   * Pathway Browser, with this page's object selected there -- "Other
   * Pathways" lists the pathways it takes part in. The Browser's own query
   * parameters (the caller's extras) mean nothing here.
   */
  navigateTo(pathwayId: string | null): Promise<boolean> {
    const select = this.route.snapshot.paramMap.get('id') ?? undefined;
    return this.router.navigate(pathwayId ? ['/PathwayBrowser', pathwayId] : ['/PathwayBrowser'], {
      queryParams: select ? { select } : {},
    });
  }

  readonly section = toSignal(this.route.fragment);
  summariseDisease = urlParam<boolean | undefined>(undefined, 'boolean');

  select = urlParam<string | null>(null, 'id');
  flag = urlParam<string[]>([], 'id');
  path = urlParam<string[]>([], 'id');
  readonly pathwayId = signal<string | undefined>(undefined);
  flagInteractors = urlParam<boolean>(false, 'boolean');
  tab = urlParam<string | null>(null, 'string');
  overlay = urlParam<string | null>(null, 'string');
  analysis = urlParam<string | null>(null, 'string');
  analysisTab = urlParam<'qualitative' | 'quantitative' | 'species' | 'tissue' | null>(
    null,
    'string'
  );
  significance = urlParam<number>(0.05, 'number');
  sample = urlParam<string | null>(null, 'string');
  // Mirrors UrlStateService, though the content pages do not draw interactors.
  // Nothing checks the two stay in step (see the class comment), so keep them so.
  interactorScore = urlParam<number>(DEFAULT_INTERACTOR_SCORE, 'number');
  palette = urlParam<any>(null, 'string');
  filterViewMode = urlParam<any>(undefined, 'string');
  speciesFilter = urlParam<string[]>([], 'string');
  resourceFilter = urlParam<any>(null, 'string');
  includeDisease = urlParam<boolean | undefined>(undefined, 'boolean');
  includeGrouping = urlParam<boolean | undefined>(undefined, 'boolean');
  pathwayMinSizeFilter = urlParam<number | undefined>(undefined, 'number');
  pathwayMaxSizeFilter = urlParam<number | undefined>(undefined, 'number');
  minExpressionFilter = urlParam<number | undefined>(undefined, 'number');
  maxExpressionFilter = urlParam<number | undefined>(undefined, 'number');
  fdrFilter = urlParam<number | undefined>(undefined, 'number');
  gsaFilter = urlParam<number[]>([], 'number');
  example = urlParam<string | null>(null, 'string');

  readonly values = {
    select: this.select,
    flag: this.flag,
    path: this.path,
    flagInteractors: this.flagInteractors,
    overlay: this.overlay,
    analysis: this.analysis,
    analysisTab: this.analysisTab,
    tab: this.tab,
    significance: this.significance,
    sample: this.sample,
    interactorScore: this.interactorScore,
    palette: this.palette,
    filterViewMode: this.filterViewMode,
    speciesFilter: this.speciesFilter,
    resourceFilter: this.resourceFilter,
    includeDisease: this.includeDisease,
    includeGrouping: this.includeGrouping,
    pathwayMinSizeFilter: this.pathwayMinSizeFilter,
    pathwayMaxSizeFilter: this.pathwayMaxSizeFilter,
    minExpressionFilter: this.minExpressionFilter,
    maxExpressionFilter: this.maxExpressionFilter,
    fdrFilter: this.fdrFilter,
    gsaFilter: this.gsaFilter,
    summariseDisease: this.summariseDisease,
    example: this.example,
  };
}

export const detailUrlStateProvider = {
  provide: UrlStateService,
  useClass: DetailUrlState,
};
