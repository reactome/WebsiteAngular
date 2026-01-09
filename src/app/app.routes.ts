import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page/home-page.component';
import { DocumentationPageComponent } from './documentation-page/documentation-page.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';

export const routes: Routes = [
    {path: '', component: HomePageComponent, pathMatch: 'full'},
    {path: 'documentation', component: DocumentationPageComponent},
    {path: '**', component: PageNotFoundComponent}
];
