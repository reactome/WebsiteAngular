import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page/home-page.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';
import { NewsArticleComponent } from './page/news/news-article/news-article.component';
import { NewsPageComponent } from './page/news/news-page/news-page.component';
import { PageComponent } from './page/page.component';

export const routes: Routes = [
    //Home Page
    { path: '', component: HomePageComponent, pathMatch: 'full' },

    //

    //Pages (Non CMS page types most go ABOVE this line)
    { path: ':slug', component: PageComponent },

    //404 Page
    { path: '**', component: PageNotFoundComponent },
    { path: '404', component: PageNotFoundComponent }
];
