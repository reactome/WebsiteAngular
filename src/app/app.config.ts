import { ApplicationConfig, NgZone, provideEnvironmentInitializer, provideZoneChangeDetection, provideZonelessChangeDetection, importProvidersFrom, ENVIRONMENT_INITIALIZER, inject } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, Router, Event, NavigationStart, NavigationEnd } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { StoreModule } from '@ngrx/store';
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store';
import { EffectsModule } from '@ngrx/effects';

import { routes } from './app.routes';

// TEMPORARY (zoneless migration spike). `?zoneless=1` boots a single page load
// without zone.js so the migration can be measured against the running dev
// server without changing what anyone else sees.
const USE_ZONELESS =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('zoneless');

export const appConfig: ApplicationConfig = {
  providers: [
    USE_ZONELESS
      ? provideZonelessChangeDetection()
      : provideZoneChangeDetection({ eventCoalescing: true }),
    // Report what actually got wired up rather than what was requested: under
    // zoneless Angular injects a NoopNgZone. A spike that can't tell "flag was
    // read" from "flag took effect" measures nothing.
    provideEnvironmentInitializer(() => {
      (globalThis as unknown as Record<string, unknown>)['__NG_CD__'] = {
        requested: USE_ZONELESS ? 'zoneless' : 'zone',
        ngZone: inject(NgZone).constructor.name,
      };
    }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideAnimations(),
    importProvidersFrom(
      StoreModule.forRoot({ router: routerReducer }),
      StoreRouterConnectingModule.forRoot(),
      EffectsModule.forRoot([])
    )/*,
    
    // ENVIRONMENT_INITIALIZER to log router events at startup
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useFactory: () => () => {
        const router = inject(Router);
        router.events.subscribe((event: Event) => {
          if (event instanceof NavigationStart) {
            console.log('NavigationStart:', event.url);
          } else if (event instanceof NavigationEnd) {
            console.log('NavigationEnd:', event.url);
          }
        });
      }
    }*/
  ]
};
