import { Routes } from '@angular/router';

export const routes: Routes = [
    { path: 'PathwayBrowser', loadChildren: () => import('../../projects/pathway-browser/src/app/app-routing.module').then(m => m.AppRoutingModule) },
    { path: '', loadChildren: () => import('../../projects/website-angular/src/app/app.routes').then(m => m.routes) },
];
