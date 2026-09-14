import {
  ApplicationConfig,
  provideZonelessChangeDetection,
  importProvidersFrom,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { StoreModule } from '@ngrx/store';
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store';
import { EffectsModule } from '@ngrx/effects';
import {
  provideGoogleAnalytics,
  provideGoogleAnalyticsRouter,
} from '@hakimio/ngx-google-analytics';
import { environment } from '../../projects/pathway-browser/src/environments/environment';

import { routes } from './app.routes';

/**
 * Analytics, when the deployment has a property to report to.
 *
 * The pathway browser has provided these since it was standalone; the site
 * around it never did, so nothing on reactome.org outside the browser was
 * counted. Wired here so the whole site reports.
 *
 * Conditional on purpose. A profile without a gtagId means "this deployment does
 * not report" -- the curator site, and any local run -- and the alternative,
 * passing an empty measurement id, loads gtag and sends to nowhere. Which
 * property each deployment uses is a profile field, so beta's traffic files
 * under beta's property rather than the public one.
 */
const analytics = environment.gtagId
  ? [provideGoogleAnalytics(environment.gtagId), provideGoogleAnalyticsRouter()]
  : [];

export const appConfig: ApplicationConfig = {
  providers: [
    // Zoneless. zone.js is no longer loaded as a polyfill, so nothing patches
    // the browser's async APIs and change detection is driven by signals,
    // template event bindings and explicit markForCheck instead.
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    // Loaded on demand rather than eagerly: the only animations in the app
    // are in the lazily routed pathway browser, so the animations engine has
    // no business sitting in the initial bundle.
    importProvidersFrom(
      StoreModule.forRoot({ router: routerReducer }),
      StoreRouterConnectingModule.forRoot(),
      EffectsModule.forRoot([])
    ),
    ...analytics,
  ],
};
