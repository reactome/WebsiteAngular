import { effect, inject, Injectable, signal, untracked, WritableSignal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, NavigationExtras, Params, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, map, of, switchMap } from 'rxjs';
import { isArray, isNumber } from 'lodash';
import { HttpClient } from '@angular/common/http';
import { CONTENT_SERVICE } from '../../environments/environment';
import { PaletteName } from './analysis.service';
import type { Analysis } from '../model/analysis.model';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * A legacy pathway link, as the old browser addressed one in the URL fragment.
 *
 * Both spellings are in the wild, because the old site produced both: counted in
 * this site's own news before its links were rewritten, 638 said
 * `#/R-HSA-1430728` and 70 said `#R-HSA-202733` with no slash. Requiring the
 * slash meant the second kind matched nothing, so every one of them opened the
 * browser with no pathway in it -- a blank page from a link in a release
 * announcement.
 *
 * The id must be there for this to match at all. A fragment that is not a
 * pathway reference -- `#introduction`, naming a section to scroll to -- has to
 * fall through untouched rather than be read as a stale route.
 *
 * A bare number is a **dbId**, which is how every release announcement used to
 * write its list of what is new: `#1280218`, not `#R-HSA-1280218`. There were
 * 285 of those in this site's own news -- 278 without the slash and 7 with, 24 of
 * them in the current release's announcement -- and every one opened the browser
 * with no pathway in it. The browser already resolves a dbId given in the path,
 * so only the fragment form was missing.
 *
 * Our own content now links by stable id, so the dbId traffic that still arrives
 * here comes from outside: citations, bookmarks and other people's pages, none of
 * which can be edited. That is why this stays.
 * Four digits at least, so an ordinary page anchor cannot be mistaken for one --
 * the shortest dbId in the content is five.
 *
 * A trailing `.4` is a stIdVersion. The old links carry it, the content service
 * does not want it, and it was previously parsed as a query parameter called
 * ".4"; it is consumed and dropped here.
 */
/**
 * The keys the old browser wrote into the fragment, and the only ones that make
 * a settings-only fragment a legacy link rather than a page anchor.
 */
const LEGACY_FRAGMENT_KEYS = [
  'TOOL',
  'DIAGRAM',
  'PATH',
  'SEL',
  'DTAB',
  'ANALYSIS',
  'FLG',
  'FLGINT',
] as const;

export const FRAGMENT_PATTERN = new RegExp(
  // Not empty, and not a lone slash. Both halves below are optional, so without
  // this an absent fragment -- read as '' -- would match, and carriesLegacyPathway()
  // would answer true for every URL in the app.
  String.raw`^\/?(?=.)` +
    // The pathway, when the link names one. Optional now: the old browser also
    // produced fragments that are only settings, `#TOOL=AT` being 45 of them in
    // this site's own news.
    String.raw`(?:(?<id>R-[A-Z]{3}-\d+|\d{4,})(?:\.\d+)?)?` +
    // The settings. The `&` is optional because it separates them from an id that
    // may not be there. Only the old browser's own keys count, so `#introduction`
    // -- a section to scroll to -- still falls through untouched rather than being
    // read as a stale route.
    String.raw`(?:&?(?<params>(?:${LEGACY_FRAGMENT_KEYS.join('|')})=.*))?$`
);

/**
 * Whether this URL is one of the content pages rather than the pathway browser.
 *
 * The content pages render some of the same panels from this same service, but
 * they own their own addresses -- so the two effects that write pathway browser
 * state into the URL have to stand down there, or opening a detail page rewrites
 * its address into a pathway browser one.
 *
 * The path, and whole segments of it. This used to ask whether the whole URL
 * *contained* "content" or "query", and the query string answers that just as
 * readily as the path does: `sample` holds a column name out of the reader's own
 * expression file -- set automatically to the first column of it -- so a file
 * with a column called "GC content" puts `?sample=GC__content` in the URL, and
 * from that moment nothing the reader did was written to the URL again. Not
 * selecting a node, not flagging, not changing tab. None of it survived a
 * reload, and none of it was in a link they shared.
 *
 * "query" is gone rather than fixed: the search page is `content/query`, which
 * the first test already covers, and of the two words it is the likelier to turn
 * up in somebody's data.
 */
export function isContentRoute(url: string): boolean {
  return url
    .split(/[?#]/, 1)[0]
    .split('/')
    .some((segment) => segment === 'content');
}

export type UrlParam<T> = WritableSignal<T> & {
  otherTokens?: string[];
  initialValue: T;
  type: 'number' | 'boolean' | 'string' | 'id';
  /**
   * Translates a value written under one of the legacy `otherTokens` into what
   * this param means now.
   *
   * The argument is a string because that is what it is: this runs only for a
   * legacy token, whose value came out of the query string unparsed. It was
   * declared `(value: T) => T`, which was true of no caller -- it went
   * unnoticed only because `tab` is a `string | null`, so the lie typechecked.
   * A param with a narrower type could not be given a transform at all.
   */
  otherTransform?: (value: string) => T;
  set?: (value: T) => void;
};

export function urlParam<T>(
  initialValue: T,
  type: UrlParam<T>['type'],
  otherTokens?: string[],
  otherTransform?: (value: string) => T
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
    // `TOOL=AT` is how the old browser opened the analysis tool, and it is the
    // "Analysis Tools" link in every release announcement we have ever published,
    // the current one included. It named no pathway and mapped to nothing here, so
    // all 45 of them opened an empty pathway browser. Qualitative is the tool's
    // first tab and its fallback, which is the gene-list upload the old link led to.
    analysisTab: urlParam<'qualitative' | 'quantitative' | 'species' | 'tissue' | null>(
      null,
      'string',
      ['TOOL'],
      (tool) => (tool === 'AT' ? 'qualitative' : null)
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

      if (isContentRoute(this.router.url)) return;

      void this.navigateTo(this.pathwayId() ?? null, {
        queryParamsHandling: 'preserve',
        preserveFragment: !this.carriesLegacyPathway(),
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

          // `DIAGRAM` is the old browser's name for the pathway to open, so it is
          // the route rather than a setting: `#DIAGRAM=9006934&PATH=162582` in the
          // v64 announcement means the same as `#9006934&PATH=162582`. It is only
          // ever a dbId, which the resolution below then swaps for the stable id.
          if (!id && typeof params['DIAGRAM'] === 'string') {
            id = params['DIAGRAM'];
            delete params['DIAGRAM'];
          }

          // `TOOL=AT` opened the analysis tool. Rewritten into the parameter that
          // does that now, rather than carried through as a legacy token, because
          // a legacy token does not survive the trip: the writer replaces the
          // whole query string as soon as any state settles, so `?tab=info`
          // arriving first dropped `?TOOL=AT` before the reader saw it. Setting
          // the signal instead does not work either -- the reader resets every
          // param the URL does not mention, so it would be undone in the same
          // turn. The URL is the source of truth, so the URL is where it goes.
          if (params['TOOL'] === 'AT') {
            params['analysisTab'] = 'qualitative';
            delete params['TOOL'];
          }
        }

        const go = (resolved: string | undefined) =>
          void this.navigateTo(resolved ?? null, {
            queryParamsHandling: 'merge',
            fragment: fragment.replace(FRAGMENT_PATTERN, ''),
            preserveFragment: false,
            queryParams: params,
            // Replace, do not add. Rewriting a legacy fragment into a proper
            // route is a correction, not a step the reader took: pushing it
            // left the old URL one Back away, and going back to it rewrote it
            // again -- so someone who followed a link out of the news archive
            // could not get back to the news archive.
            replaceUrl: true,
          });

        // A legacy link may name a pathway by dbId. Navigate on it straight
        // away -- the browser resolves one, and going first means the fragment
        // is consumed in the same turn as an `#R-HSA-…` one, before anything
        // else writes a history entry that still carries it.
        //
        // Then swap the URL for the stable id, replacing rather than pushing: a
        // dbId is not stable across releases, so it is not a URL to leave a
        // reader holding, but correcting it is not a step they took.
        go(id);
        if (id && /^\d+$/.test(id)) {
          void this.dbIdToStId(Number(id)).then((stId) => {
            if (stId && stId !== id) {
              void this.navigateTo(stId, {
                queryParamsHandling: 'preserve',
                preserveFragment: false,
                replaceUrl: true,
              });
            }
          });
        }
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
      const queryParams = this.currentQueryParams();
      if (isContentRoute(this.router.url)) return;

      // Settling is not a step the reader took, so it replaces rather than adds:
      // opening a pathway wrote ?tab=info and then ?tab=details, two entries for a
      // choice nobody made, so Back changed the tab twice before it left.
      //
      // Decided from the values rather than from a flag. A flag raised by
      // settle() and read here outlives its turn whenever this does not run --
      // the early return above, or a default that was already the current value,
      // so no signal changed at all -- and the reader's next write, a real one,
      // would then quietly replace their history instead of adding to it.
      const settled = this.settledParams;
      this.settledParams = null;

      void this.navigateTo(this.pathwayId() ?? null, {
        queryParams,
        preserveFragment: !this.carriesLegacyPathway(),
        replaceUrl: settled !== null && settled === JSON.stringify(queryParams),
      });
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
  /**
   * Whether the URL still carries a legacy pathway reference in its fragment.
   *
   * Such a fragment is on its way out: it is being rewritten into a proper
   * route. Until then the other navigations here -- writing state into the URL,
   * following a pathway change -- must not carry it along, because every entry
   * they carry it into is one that rewrites itself forward when the reader goes
   * back to it. Someone who followed a link out of the news archive could not
   * get back to the news archive: three Backs, still on the pathway.
   */
  private carriesLegacyPathway(): boolean {
    return FRAGMENT_PATTERN.test(this.route.snapshot.fragment ?? '');
  }

  /** The params settle() last wrote, so the writer can recognise its own work. */
  private settledParams: string | null = null;

  /**
   * Make a state change the reader did not ask for.
   *
   * The URL still has to say what is on screen -- a link has to be shareable --
   * but writing a default nobody chose should not cost them a press of Back.
   * Choosing a tab pushes; being given one replaces.
   */
  settle(change: () => void): void {
    change();
    // What the URL should now say. The writer replaces only if it is about to
    // write exactly this, which is what keeps the decision out of a flag.
    //
    // Untracked, and that is the whole of it: settle() is called from inside an
    // effect, so reading every param here made that effect depend on every
    // param. Choosing a tab then re-ran the defaulting effect, which set the
    // tab back to its default -- the reader's click did nothing at all.
    this.settledParams = JSON.stringify(untracked(() => this.currentQueryParams()));
  }

  /** The query params the current state should put in the URL. */
  private currentQueryParams(): Record<string, unknown> {
    const queryParams: Record<string, unknown> = {};
    for (const key in this.values) {
      const param = this.values[key as keyof State];
      let paramValue: unknown = param();
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
    return queryParams;
  }

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

  /**
   * The stable id for a dbId, asked for as text rather than as an object.
   *
   * `/stId` answers 13 bytes; fetching the object to read one field off it is
   * 12,682. Falls back to the dbId, which the browser can still load: a page on
   * a worse URL beats a link that goes nowhere.
   */
  async dbIdToStId(dbId: number): Promise<string> {
    return firstValueFrom(
      this.http
        .get(`${CONTENT_SERVICE}/data/query/${dbId}/stId`, { responseType: 'text' })
        .pipe(catchError(() => of(dbId + '')))
    );
  }
}
