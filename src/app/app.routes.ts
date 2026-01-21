import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page/home-page.component';
import { DocumentationPageComponent } from './documentation-page/documentation-page.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';
import { NewsArticleComponent } from './about-page/news/news-article/news-article.component';
import { NewsPageComponent } from './about-page/news/news-page/news-page.component';

export const routes: Routes = [
    {path: '', component: HomePageComponent, pathMatch: 'full'},
    {path: 'documentation', component: DocumentationPageComponent},
    {path: 'about/news', component: NewsPageComponent},
    {path: 'about/news/:slug', component: NewsArticleComponent},
    {path: '**', component: PageNotFoundComponent}
];
