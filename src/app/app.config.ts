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

import { routes } from './app.routes';

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
  ],
};
