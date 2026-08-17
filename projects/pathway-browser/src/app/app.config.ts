import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app-routing.module';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideUiTour } from 'ngx-ui-tour-md-menu';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { routerReducer, provideRouterStore } from '@ngrx/router-store';
import { provideEffects } from '@ngrx/effects';
import {
  provideGoogleAnalytics,
  provideGoogleAnalyticsRouter,
} from '@hakimio/ngx-google-analytics';
import { environment } from '../environments/environment';
import { DatePipe } from '@angular/common';

export const appConfig: ApplicationConfig = {
  providers: [
    // ngx-ui-tour 16 no longer provides TourService in root; without this the
    // GSA form's tour anchors fail with NG0201 and the whole viewport dies.
    provideUiTour(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimations(),
    provideHttpClient(withInterceptorsFromDi()),
    provideStore({
      router: routerReducer,
    }),
    provideRouterStore(),
    provideEffects([]),
    provideGoogleAnalytics(environment.gtagId ?? ''),
    provideGoogleAnalyticsRouter(),
    {
      provide: LOCALE_ID,
      useFactory: () => navigator.language || 'en-US',
    },
    DatePipe,
  ],
};
