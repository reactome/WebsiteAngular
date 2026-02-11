import { Routes } from '@angular/router';

export const routes: Routes = [
    //Home Page
    { path: '', loadComponent: () => import('./home-page/home-page.component').then(m => m.HomePageComponent), pathMatch: 'full' },

    /* Non - CMS Pages Below this Line */
    //News Pages
    { path: 'about/news', loadComponent: () => import('./article/article-page/article-page.component').then(m => m.ArticlePageComponent), pathMatch: 'full' },
    { path: 'about/news/:slug', loadComponent: () => import('./article/article/article.component').then(m => m.ArticleComponent), pathMatch: 'full' },

    //Reactome Research Spotlights
    { path: 'content/reactome-research-spotlight', loadComponent: () => import('./article/article-page/article-page.component').then(m => m.ArticlePageComponent), pathMatch: 'full' },
    { path: 'content/reactome-research-spotlight/:slug', loadComponent: () => import('./article/article/article.component').then(m => m.ArticleComponent), pathMatch: 'full' },

    //404 Page
    { path: '404', loadComponent: () => import('./page-not-found/page-not-found.component').then(m => m.PageNotFoundComponent), pathMatch: 'full' },
    /* Non - CMS Pages Above this Line */

    //CMS Pages
    { path: '**', loadComponent: () => import('./page/page.component').then(m => m.PageComponent) },
    
];
