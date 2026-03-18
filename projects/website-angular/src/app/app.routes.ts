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
    { path: 'community/contributors', loadComponent: () => import('./content/contributors/contributors.component').then(m => m.ContributorsComponent), pathMatch: 'full' },

    //Documentation Pages
    { path: 'documentation/faq', loadComponent: () => import('./documentation/faq/faq.component').then(m => m.FaqComponent), pathMatch: 'full' },

    //Download Page
    { path: 'download-data', loadComponent: () => import('./download-data/download-data.component').then(m => m.DownloadDataComponent), pathMatch: 'full' },

    //Reactome Research Spotlights
    { path: 'content/reactome-research-spotlight', loadComponent: () => import('./article/article-page/article-page.component').then(m => m.ArticlePageComponent), pathMatch: 'full' },
    { path: 'content/reactome-research-spotlight/:slug', loadComponent: () => import('./article/article/article.component').then(m => m.ArticleComponent), pathMatch: 'full' },

    //Content Pages (TOC, DOI, Schema)
    { path: 'content/toc', loadComponent: () => import('./content/toc/toc.component').then(m => m.TocComponent), pathMatch: 'full' },
    { path: 'content/doi', loadComponent: () => import('./content/doi/doi.component').then(m => m.DoiComponent), pathMatch: 'full' },
    { path: 'content/schema', loadComponent: () => import('./content/schema/schema.component').then(m => m.SchemaComponent), pathMatch: 'full' },
    { path: 'content/schema/:className', loadComponent: () => import('./content/schema/schema.component').then(m => m.SchemaComponent), pathMatch: 'full' },

    //Detail Pages
    { path: 'content/detail/interactor/:acc', loadComponent: () => import('./content/detail/interactor-detail/interactor-detail.component').then(m => m.InteractorDetailComponent) },
    { path: 'content/detail/icon/:id', loadComponent: () => import('./content/detail/icon-detail/icon-detail.component').then(m => m.IconDetailComponent) },
    { path: 'content/detail/:id', loadComponent: () => import('./content/detail/detail.component').then(m => m.DetailComponent) },

    //Search Pages
    { path: 'content/query', loadComponent: () => import('./search/search.component').then(m => m.SearchComponent) },
    { path: 'tools/site-search', loadComponent: () => import('./site-search/site-search.component').then(m => m.SiteSearchComponent) },

    //API Documentation (Swagger UI)
    { path: 'ContentService', loadComponent: () => import('./swagger-page/swagger-page.component').then(m => m.SwaggerPageComponent), data: { serviceName: 'ContentService' } },
    { path: 'AnalysisService', loadComponent: () => import('./swagger-page/swagger-page.component').then(m => m.SwaggerPageComponent), data: { serviceName: 'AnalysisService' } },

    //404 Page
    { path: '404', loadComponent: () => import('./page-not-found/page-not-found.component').then(m => m.PageNotFoundComponent) }, //TODO: Remove?
    /* Non - CMS Pages Above this Line */

    //CMS Pages
    { path: '**', loadComponent: () => import('./page/page.component').then(m => m.PageComponent) },
    
];
