import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom, ENVIRONMENT_INITIALIZER, inject } from '@angular/core';
import { provideUiTour } from 'ngx-ui-tour-md-menu';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, Router, Event, NavigationStart, NavigationEnd } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { StoreModule } from '@ngrx/store';
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store';
import { EffectsModule } from '@ngrx/effects';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // ngx-ui-tour 16 no longer provides TourService in root; without this the
    // GSA form's tour anchors fail with NG0201 and the whole viewport dies.
    provideUiTour(),
    provideZoneChangeDetection({ eventCoalescing: true }),
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
