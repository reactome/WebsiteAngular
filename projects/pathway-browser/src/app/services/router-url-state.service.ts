import { effect, inject, Injectable, untracked } from '@angular/core';
import { ActivatedRoute, NavigationEnd, NavigationExtras, Params, Router } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FRAGMENT_PATTERN,
  fragmentParams,
  isContentRoute,
  StateValues,
  UrlParam,
  UrlStateService,
} from './url-state.service';

@UntilDestroy()
/**
 * The Pathway Browser's state, kept in the address bar.
 *
 * What the site provides for UrlStateService (src/app/app.config.ts). It is a
 * class of its own, rather than the token everything injects, so that the
 * embeddable diagram -- which keeps the same state in memory and never routes --
 * does not carry the router in its bundle (#356).
 */
@Injectable()
export class RouterUrlStateService extends UrlStateService {
  private route: ActivatedRoute = inject(ActivatedRoute);
  private router: Router = inject(Router);

  override readonly section = toSignal(this.route.fragment);

  constructor() {
    super();
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
        if (match?.groups) {
          if (match.groups['id']) {
            id = match.groups['id'];
          }
          if (match.groups['params']) {
            Object.assign(params, fragmentParams(match.groups['params']));
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
          const param = this.values[mainToken as keyof StateValues] as UrlParam<any>;
          const tokens: string[] = [mainToken, ...(param.otherTokens || [])];
          const token = tokens.find((token) => params[token] !== undefined);
          if (token) {
            const initialValue = param.initialValue;
            let value = params[token];
            if (value === undefined || value === null) param.set(value);
            if (param.otherTransform && token !== mainToken) value = param.otherTransform(value);
            else {
              if (Array.isArray(initialValue)) {
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
  override settle(change: () => void): void {
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
      const param = this.values[key as keyof StateValues];
      let paramValue: unknown = param();
      if (
        paramValue === undefined ||
        paramValue === null ||
        (Array.isArray(paramValue) && paramValue.length === 0) ||
        paramValue === param.initialValue
      )
        continue;
      if (typeof paramValue === 'string') paramValue = paramValue.replaceAll(' ', '__');
      queryParams[key] = Array.isArray(paramValue) ? paramValue.join(';') : paramValue;
    }
    return queryParams;
  }

  override navigateTo(pathwayId: string | null, extras: NavigationExtras = {}): Promise<boolean> {
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

  override isFirstNavigation(): boolean {
    return !this.router.currentNavigation()?.previousNavigation;
  }

  override queryParams(): Params {
    return this.route.snapshot.queryParams;
  }
}
