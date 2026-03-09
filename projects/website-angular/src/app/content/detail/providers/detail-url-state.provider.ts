import {inject, Injectable, signal} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {UrlStateService, urlParam} from '../../../../../../pathway-browser/src/app/services/url-state.service';

@Injectable()
export class DetailUrlState implements Partial<UrlStateService> {
  private route = inject(ActivatedRoute);

  section = toSignal(this.route.fragment);
  summariseDisease = urlParam<boolean | undefined>(undefined, 'boolean');

  select = urlParam<string | null>(null, 'id');
  flag = urlParam<string[]>([], 'id');
  path = urlParam<string[]>([], 'id');
  pathwayId = signal<string | undefined>(undefined);
  flagInteractors = urlParam<boolean>(false, 'boolean');
  tab = urlParam<string | null>(null, 'string');
  overlay = urlParam<string | null>(null, 'string');
  analysis = urlParam<string | null>(null, 'string');
  significance = urlParam<number>(0.05, 'number');
  sample = urlParam<string | null>(null, 'string');
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
    tab: this.tab,
    significance: this.significance,
    sample: this.sample,
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
