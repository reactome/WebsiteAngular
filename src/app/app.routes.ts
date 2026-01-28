import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page/home-page.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';
import { NewsArticleComponent } from './news/news-article/news-article.component';
import { NewsPageComponent } from './news/news-page/news-page.component';
import { PageComponent } from './page/page.component';

export const routes: Routes = [
    //Home Page
    { path: '', component: HomePageComponent, pathMatch: 'full' },

    /* Non - CMS Pages Below this Line */
    //News Pages
    { path: 'about/news', component: NewsPageComponent, pathMatch: 'full' },
    { path: 'about/news/:slug', component: NewsArticleComponent, pathMatch: 'full' },

    //404 Page
    { path: '404', component: PageNotFoundComponent, pathMatch: 'full' },
    /* Non - CMS Pages Above this Line */

    //CMS Pages
    { path: '**', component: PageComponent },
    
];
