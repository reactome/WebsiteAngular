import { inject, Signal, signal, WritableSignal } from '@angular/core';
import type { NavigationExtras, Params } from '@angular/router';
import { catchError, firstValueFrom, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { CONTENT_SERVICE } from '../../environments/environment';
import type { PaletteName } from './analysis.service';
import type { Analysis } from '../model/analysis.model';
import { DEFAULT_INTERACTOR_SCORE } from '../interactors/interactor-threshold';

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

/** The `KEY=value&...` part of a legacy fragment link; a bare key is true. */
export function fragmentParams(text: string): Record<string, string | true> {
  const params: Record<string, string | true> = {};
  // On the first "=" only: an analysis token is base64 and often ends in "=".
  for (const param of text.split('&')) {
    const at = param.indexOf('=');
    const [key, value] = at === -1 ? [param, ''] : [param.slice(0, at), param.slice(at + 1)];
    params[key] = value || true;
  }
  return params;
}

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
  const [path = url] = url.split(/[?#]/, 1);
  return path.split('/').some((segment) => segment === 'content');
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
  if (otherTokens) writableSignal.otherTokens = otherTokens;
  writableSignal.initialValue = initialValue;
  writableSignal.type = type;
  if (otherTransform) writableSignal.otherTransform = otherTransform;
  return writableSignal;
}

/**
 * Every piece of Pathway Browser state, as signals.
 *
 * A factory so the embeddable diagram's in-memory state
 * (projects/reactome-diagram-element) is built from exactly these definitions:
 * two copies of this list would drift, and a param added here but not there is
 * a param the embedded diagram silently ignores.
 */
export function createStateValues(oldToNewTab: ReadonlyMap<string | null, string>) {
  return {
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
    tab: urlParam<string | null>(null, 'string', ['DTAB'], (tab) => oldToNewTab.get(tab)!),
    significance: urlParam<number>(0.05, 'number'),
    sample: urlParam<string | null>(null, 'string'),
    /**
     * The lowest interaction confidence the reader wants drawn.
     *
     * 0.45 is the old browser's default -- DEFAULT_SCORE in pwp-diagram's
     * InteractorsContent.java -- so a curator comparing the two sites on one
     * entity sees the same first view.
     *
     * Declaring it with that initial value is also what keeps it out of an
     * address nobody edited: currentQueryParams() skips any value equal to its
     * initialValue, so a reader who never touched the control shares a link with
     * no threshold in it. That is a requirement met by the existing mechanism
     * rather than by a special case.
     */
    interactorScore: urlParam<number>(DEFAULT_INTERACTOR_SCORE, 'number'),
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
}

export type StateValues = ReturnType<typeof createStateValues>;

/** The old browser's tab codes, and the tabs they are now. */
const TABS_COMPATIBILITY: [string | null, string][] = [
  ['ST', 'details'],
  [null, 'details'],
  ['MT', 'molecule'],
  ['AN', 'results'],
  ['EX', 'expression'],
  ['DT', 'download'],
];

/**
 * The Pathway Browser's state, as everything that draws a pathway injects it.
 *
 * Where it is kept is up to the subclass. The site keeps it in the address bar
 * (RouterUrlStateService, provided in src/app/app.config.ts); the embeddable
 * diagram keeps it in memory (projects/reactome-diagram-element's MemoryState).
 * This class imports nothing from the router -- only its types -- so the embed,
 * which never routes, does not carry the router in its bundle (#356).
 */
export abstract class UrlStateService implements StateValues {
  private readonly http = inject(HttpClient);

  readonly oldToNewTab = new Map(TABS_COMPATIBILITY);
  readonly newToOldTab = new Map(TABS_COMPATIBILITY.map(([newTab, oldTab]) => [oldTab, newTab]));

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

  readonly pathwayId: WritableSignal<string | undefined> = signal<string | undefined>(undefined);

  /** The section of the page named in the address, if there is one. */
  abstract readonly section: Signal<string | null | undefined>;

  /**
   * Make a state change the reader did not ask for: where there is a history,
   * it does not add a step to it.
   */
  abstract settle(change: () => void): void;

  /** Open a pathway, or none. */
  abstract navigateTo(pathwayId: string | null, extras?: NavigationExtras): Promise<boolean>;

  /** Whether this is the first page opened here: nothing came before it. */
  abstract isFirstNavigation(): boolean;

  /** The query parameters in the address now; none where there is no address. */
  abstract queryParams(): Params;

  async ensureStId(id: string | number): Promise<string> {
    return typeof id === 'number' ? this.dbIdToStId(id) : id;
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
