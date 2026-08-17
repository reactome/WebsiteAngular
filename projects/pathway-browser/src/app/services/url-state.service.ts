import { effect, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, NavigationExtras, Params, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, map, of, switchMap } from 'rxjs';
import { isArray, isNumber } from 'lodash';
import { HttpClient } from '@angular/common/http';
import { CONTENT_SERVICE } from '../../environments/environment';
import { PaletteName } from './analysis.service';
import type { Analysis } from '../model/analysis.model';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { toSignal } from '@angular/core/rxjs-interop';

const FRAGMENT_PATTERN = /\/(?<id>R-[A-Z]{3}-\d+)?&?(?<params>.*)/;

export type UrlParam<T> = WritableSignal<T> & {
  otherTokens?: string[];
  initialValue: T;
  type: 'number' | 'boolean' | 'string' | 'id';
  otherTransform?: (value: T) => T;
  set?: (value: T) => void;
};

export function urlParam<T>(
  initialValue: T,
  type: UrlParam<T>['type'],
  otherTokens?: string[],
  otherTransform?: (value: T) => T
): UrlParam<T> {
  const writableSignal = signal<T>(initialValue, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }) as UrlParam<T>;
  writableSignal.otherTokens = otherTokens;
  writableSignal.initialValue = initialValue;
  writableSignal.type = type;
  writableSignal.otherTransform = otherTransform;
  return writableSignal;
}

type State = UrlStateService['values'];

@UntilDestroy()
@Injectable({
  providedIn: 'root',
})
export class UrlStateService implements State {
  private route: ActivatedRoute = inject(ActivatedRoute);
  private router: Router = inject(Router);
  private http: HttpClient = inject(HttpClient);

  private readonly tabsCompatibility: [string | null, string][] = [
    ['ST', 'details'],
    [null, 'details'],
    ['MT', 'molecule'],
    ['AN', 'results'],
    ['EX', 'expression'],
    ['DT', 'download'],
  ];
  readonly oldToNewTab = new Map(this.tabsCompatibility);
  readonly newToOldTab = new Map(
    this.tabsCompatibility.map(([newTab, oldTab]) => [oldTab, newTab])
  );

  readonly values = {
    select: urlParam<string | null>(null, 'id', ['SEL']),
    flag: urlParam<string[]>([], 'id', ['FLG']),
    path: urlParam<string[]>([], 'id', ['PATH']),
    flagInteractors: urlParam<boolean>(false, 'boolean', ['FLGINT']),
    overlay: urlParam<string | null>(null, 'string'),
    analysis: urlParam<string | null>(null, 'string', ['ANALYSIS']),
    analysisTab: urlParam<'qualitative' | 'quantitative' | 'species' | 'tissue' | null>(
      null,
      'string'
    ),
    tab: urlParam<string | null>(null, 'string', ['DTAB'], (tab) => this.oldToNewTab.get(tab)!),
    significance: urlParam<number>(0.05, 'number'),
    sample: urlParam<string | null>(null, 'string'),
    palette: urlParam<PaletteName | null>(null, 'string'),
    filterViewMode: urlParam<'focus' | 'overview' | undefined>(undefined, 'string'),
    speciesFilter: urlParam<string[]>([], 'string'),
    resourceFilter: urlParam<Analysis.Resource | null>(null, 'string'),
    includeDisease: urlParam<boolean | undefined>(undefined, 'boolean'),
    includeGrouping: urlParam<boolean | undefined>(undefined, 'boolean'),
    pathwayMinSizeFilter: urlParam<number | undefined>(undefined, 'number'),
    pathwayMaxSizeFilter: urlParam<number | undefined>(undefined, 'number'),
    minExpressionFilter: urlParam<number | undefined>(undefined, 'number'),
    maxExpressionFilter: urlParam<number | undefined>(undefined, 'number'),
    fdrFilter: urlParam<number | undefined>(undefined, 'number'),
    gsaFilter: urlParam<number[]>([], 'number'),
    summariseDisease: urlParam<boolean | undefined>(undefined, 'boolean'),
    example: urlParam<string | null>(null, 'string'),
  };

  public readonly select = this.values.select;
  public readonly flag = this.values.flag;
  public readonly path = this.values.path;
  public readonly flagInteractors = this.values.flagInteractors;
  public readonly overlay = this.values.overlay;
  public readonly analysis = this.values.analysis;
  public readonly analysisTab = this.values.analysisTab;
  public readonly tab = this.values.tab;
  public readonly significance = this.values.significance;
  public readonly sample = this.values.sample;
  public readonly palette = this.values.palette;
  public readonly filterViewMode = this.values.filterViewMode;
  public readonly speciesFilter = this.values.speciesFilter;
  public readonly resourceFilter = this.values.resourceFilter;
  public readonly includeDisease = this.values.includeDisease;
  public readonly includeGrouping = this.values.includeGrouping;
  public readonly pathwayMinSizeFilter = this.values.pathwayMinSizeFilter;
  public readonly pathwayMaxSizeFilter = this.values.pathwayMaxSizeFilter;
  public readonly minExpressionFilter = this.values.minExpressionFilter;
  public readonly maxExpressionFilter = this.values.maxExpressionFilter;
  public readonly fdrFilter = this.values.fdrFilter;
  public readonly gsaFilter = this.values.gsaFilter;
  public readonly summariseDisease = this.values.summariseDisease;
  public readonly example = this.values.example;

  public readonly pathwayId = signal<string | undefined>(undefined);

  section = toSignal(this.route.fragment);

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        switchMap(() => {
          let route = this.router.routerState.root;
          while (route.firstChild) route = route.firstChild;
          return route.params;
        }),
        map((params) => params['pathwayId'])
      )
      .subscribe((id) => {
        this.pathwayId.set(id);
      });

    effect(() => {
      // console.log('Updating patwhayId to ', this.pathwayId())

      //If in content/search do not navigate
      if (this.router.url.includes('content') || this.router.url.includes('query')) {
        // console.log('In content or search route, not navigating on pathwayId change');
        return;
      }

      void this.navigateTo(this.pathwayId() ?? null, {
        queryParamsHandling: 'preserve',
        preserveFragment: true,
      });
    });

    this.route.fragment.pipe(untilDestroyed(this)).subscribe((fragment) => {
      if (fragment) {
        // Convert fragments to params
        const params: Params = {};
        let id = undefined; // Default routing

        const match = fragment.match(FRAGMENT_PATTERN);
        if (match && match.groups) {
          if (match.groups['id']) {
            id = match.groups['id'];
          }
          if (match.groups['params']) {
            match.groups['params']
              .split('&')
              .map((param) => param.split('='))
              .forEach(([key, value]) => {
                params[key] = value || true;
              });
          }
        }

        void this.navigateTo(id ?? null, {
          queryParamsHandling: 'merge',
          fragment: fragment.replace(FRAGMENT_PATTERN, ''),
          preserveFragment: false,
          queryParams: params,
        });
      }
    });

    this.route.queryParams.pipe(untilDestroyed(this)).subscribe((params) => {
      // Kept synchronous: subscribe ignores what the callback returns, so a
      // rejection in here would go unreported.
      void (async () => {
        for (const mainToken in this.values) {
          const param = this.values[mainToken as keyof State] as UrlParam<any>;
          const tokens: string[] = [mainToken, ...(param.otherTokens || [])];
          const token = tokens.find((token) => params[token] !== undefined);
          if (token) {
            const initialValue = param.initialValue;
            let value = params[token];
            if (value === undefined || value === null) param.set(value);
            if (param.otherTransform && token !== mainToken) value = param.otherTransform(value);
            else {
              if (isArray(initialValue)) {
                let values: any[] = value.split(';');
                if (param.type === 'id') {
                  const mixedValues = values.map((v) =>
                    v.charAt(0).match(/\d/) ? parseInt(v) : v
                  );
                  values = await Promise.all(mixedValues.map((v) => this.ensureStId(v)));
                }
                if (param.type === 'number') values = values.map((v) => +v);
                if (param.type === 'boolean') values = values.map((v) => v === 'true');
                param.set(values);
              } else if (param.type === 'boolean') {
                param.set(value === 'true');
              } else if (param.type === 'id') {
                param.set(await this.ensureStId(value));
              } else if (param.type === 'number') {
                param.set(parseFloat(value));
              } else {
                param.set(value.replaceAll('__', ' '));
              }
            }
          } else {
            param.set(param.initialValue);
          }
        }
      })().catch((error) => console.error('Could not apply URL parameters', error));
    });
    effect(() => {
      const queryParams = {} as any;
      for (const key in this.values) {
        const param = this.values[key as keyof State];
        let paramValue = param();
        if (
          paramValue === undefined ||
          paramValue === null ||
          (isArray(paramValue) && paramValue.length === 0) ||
          paramValue === param.initialValue
        )
          continue;
        if (typeof paramValue === 'string') paramValue = paramValue.replaceAll(' ', '__');
        queryParams[key] = isArray(paramValue) ? paramValue.join(';') : paramValue;
      }
      // console.log('Updating URL from state', queryParams)
      if (this.router.url.includes('content') || this.router.url.includes('query')) {
        // console.log('In content or search route, not navigating on state change');
        return;
      }
      void this.navigateTo(this.pathwayId() ?? null, { queryParams, preserveFragment: true });
    });
  }

  /**
   * Navigate to a pathway within the PathwayBrowser route context.
   * Resolves the correct base path whether running standalone or inside the umbrella app.
   *
   * Router.navigate rejects when navigation fails -- a guard throwing, a
   * resolver erroring -- and almost every caller here ignores the result, so
   * those failures went nowhere. A rejection handler is attached here so they
   * are always reported; the promise is still returned for the one caller that
   * legitimately chains on navigation having finished.
   */
  navigateTo(pathwayId: string | null, extras: NavigationExtras = {}): Promise<boolean> {
    let route = this.router.routerState.root;
    while (route.firstChild) route = route.firstChild;
    const segments = pathwayId ? [pathwayId] : [];
    const navigation = this.router.navigate(segments, {
      relativeTo: route.parent,
      ...extras,
    });
    navigation.catch((error) => console.error('Navigation failed', segments, error));
    return navigation;
  }

  async ensureStId(id: string | number): Promise<string> {
    return isNumber(id) ? this.dbIdToStId(id) : id;
  }

  async dbIdToStId(dbId: number): Promise<string> {
    return firstValueFrom(
      this.http
        .get(`${CONTENT_SERVICE}/data/query/${dbId}/stId`, { responseType: 'text' })
        .pipe(catchError(() => of(dbId + '')))
    );
  }
}
