import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page/home-page.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';
import { ArticleComponent } from './news/article/article.component';
import { ArticlePageComponent } from './news/article-page/article-page.component';
import { PageComponent } from './page/page.component';

export const routes: Routes = [
    //Home Page
    { path: '', component: HomePageComponent, pathMatch: 'full' },

    /* Non - CMS Pages Below this Line */
    //News Pages
    { path: 'about/news', component: ArticlePageComponent, pathMatch: 'full' },
    { path: 'about/news/:slug', component: ArticleComponent, pathMatch: 'full' },

    //Reactome Research Spotlights
    { path: 'content/reactome-research-spotlight', component: ArticlePageComponent, pathMatch: 'full' },
    { path: 'content/reactome-research-spotlight/:slug', component: ArticleComponent, pathMatch: 'full' },

    //404 Page
    { path: '404', component: PageNotFoundComponent, pathMatch: 'full' },
    /* Non - CMS Pages Above this Line */

    //CMS Pages
    { path: '**', component: PageComponent },
    
];
