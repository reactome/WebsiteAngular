import { Routes } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { routerReducer, provideRouterStore } from '@ngrx/router-store';
import { provideEffects } from '@ngrx/effects';
import { provideAnimations } from '@angular/platform-browser/animations';

export const routes: Routes = [
    { 
        path: 'PathwayBrowser', 
        providers: [
            provideStore({ router: routerReducer }),
            provideRouterStore(),
            provideEffects([]),
            provideAnimations(),
        ],
        loadChildren: () => import('../../projects/pathway-browser/src/app/app-routing.module').then(m => m.routes) 
    },
    { 
        path: '', 
        loadComponent: () => import('../../projects/website-angular/src/app/app.component').then(m => m.AppComponent),
        loadChildren: () => import('../../projects/website-angular/src/app/app.routes').then(m => m.routes) 
    },
];
