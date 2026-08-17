import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'pathwaybrowser',
    redirectTo: 'PathwayBrowser',
    pathMatch: 'full',
  },
  {
    path: 'PathwayBrowser',
    // provideAnimations() is already registered once for the whole app in
    // src/app/app.config.ts. Registering it again here created a second,
    // independent animation engine that queued animations on this route's
    // elements but never flushed them (stuck "ng-animate-queued" forever) —
    // that's what broke the analysis dropdown's open/close transition.
    loadChildren: () =>
      import('../../projects/pathway-browser/src/app/app-routing.module').then((m) => m.routes),
  },
  {
    path: '',
    loadComponent: () =>
      import('../../projects/website-angular/src/app/app.component').then((m) => m.AppComponent),
    loadChildren: () =>
      import('../../projects/website-angular/src/app/app.routes').then((m) => m.routes),
  },
];
