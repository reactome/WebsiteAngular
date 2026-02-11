import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { StoreModule } from '@ngrx/store';
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store';
import { EffectsModule } from '@ngrx/effects';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    importProvidersFrom(
      StoreModule.forRoot({ router: routerReducer }),
      StoreRouterConnectingModule.forRoot(),
      EffectsModule.forRoot([])
    )
  ]
};
