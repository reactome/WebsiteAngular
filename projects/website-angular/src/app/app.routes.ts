import { Routes, UrlSegment } from '@angular/router';

export const routes: Routes = [
    //Home Page
    { path: '', loadComponent: () => import('./home-page/home-page.component').then(m => m.HomePageComponent), pathMatch: 'full' },

    /* Non - CMS Pages Below this Line */
    //News Pages
    { path: 'about/news', loadComponent: () => import('./article/article-page/article-page.component').then(m => m.ArticlePageComponent), pathMatch: 'full' },
    { path: 'about/news/:slug', loadComponent: () => import('./article/article/article.component').then(m => m.ArticleComponent), pathMatch: 'full' },
    { path: 'about/logo', loadComponent: () => import('./about/logo-page/logo-page.component').then(m => m.LogoPageComponent), pathMatch: 'full' },
    { path: 'about/release-calendar', loadComponent: () => import('./about/release-calendar/release-calendar.component').then(m => m.ReleaseCalendarComponent), pathMatch: 'full' },
    { path: 'about/editorial-calendar', loadComponent: () => import('./about/editorial-calendar/editorial-calendar.component').then(m => m.EditorialCalendarComponent), pathMatch: 'full' },

    //Community Pages
    { path: 'community/partners', loadComponent: () => import('./community/partners/partners.component').then(m => m.PartnersComponent), pathMatch: 'full' },
    { path: 'community/resources', loadComponent: () => import('./community/resources/resources.component').then(m => m.ResourcesComponent), pathMatch: 'full' },
    { path: 'community/collaboration', loadComponent: () => import('./community/collaboration/collaboration.component').then(m => m.CollaborationComponent), pathMatch: 'full' },
    { path: 'community/icon-lib', loadComponent: () => import('./community/icon-lib/icon-lib.component').then(m => m.IconLibComponent), pathMatch: 'full' },
    { path: 'community/icon-lib/:id', loadComponent: () => import('./community/icon-lib/icon-lib.component').then(m => m.IconLibComponent), pathMatch: 'full' },

    //Download Page
    { path: 'download-data', loadComponent: () => import('./download-data/download-data.component').then(m => m.DownloadDataComponent), pathMatch: 'full' },

    //Reactome Research Spotlights
    { path: 'content/reactome-research-spotlight', loadComponent: () => import('./article/article-page/article-page.component').then(m => m.ArticlePageComponent), pathMatch: 'full' },
    { path: 'content/reactome-research-spotlight/:slug', loadComponent: () => import('./article/article/article.component').then(m => m.ArticleComponent), pathMatch: 'full' },

    //Search Page
    { path: 'content/query', loadComponent: () => import('./search/search.component').then(m => m.SearchComponent) },

    //404 Page
    { path: '404', loadComponent: () => import('./page-not-found/page-not-found.component').then(m => m.PageNotFoundComponent) }, //TODO: Remove?
    /* Non - CMS Pages Above this Line */

    //CMS Pages
    { path: '**', loadComponent: () => import('./page/page.component').then(m => m.PageComponent) },
    
];
