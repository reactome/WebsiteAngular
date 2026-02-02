import { Component, inject } from '@angular/core';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";
import { TileComponent } from "../../reactome-components/tile/tile.component";
import { ContentService  } from '../../../services/content.service';
import { ArticleIndexItem } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { MatIcon } from "@angular/material/icon";
import { ActivatedRoute } from '@angular/router';
import stripFirstH from '../../../utils/stripFirstH';
import { marked } from 'marked';


@Component({
  selector: 'app-article-page',
  imports: [PageLayoutComponent, TileComponent, MatIcon],
  templateUrl: './article-page.component.html',
  styleUrl: './article-page.component.scss'
})
export class ArticlePageComponent {
    private route =  inject(ActivatedRoute);
    private contentService = inject(ContentService);

    pageTile: string = "News & Updates";
    pageDescription: string = "Stay up to date with the latest Reactome releases, publications, and announcements.";
    articlePath: string = "about/news";

    articles: ArticleIndexItem[] = [];
    loading = true;

    ngOnInit() {
      this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        if (path_segments.includes('about')) {
          this.loadArticles('about/news');
          this.pageTile = "News & Updates";
          this.pageDescription = "Stay up to date with the latest Reactome releases, publications, and announcements.";
          this.articlePath = "about/news";
        } else if (path_segments.includes('content')) {
          this.loadArticles('content/reactome-research-spotlight');
          this.pageTile = "Reactome Research Spotlights";
          this.pageDescription = "Explore the latest research spotlights from Reactome.";
          this.articlePath = "content/reactome-research-spotlight";
        }
      }
    });
    }

    private loadArticles(path: string) {
    this.loading = true;
    // Fetch all articles from TinaCMS GraphQL API
    this.contentService.getAllArticles(path).subscribe({
      next: async (result) => {
        this.articles = result.map((item: ArticleIndexItem) => ({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug,
          excerpt: item.excerpt
        } ));

        this.articles.forEach( async (article) => {
          let html = await marked(article?.excerpt || '');
          let renderedContent = stripFirstH(html);
          article.excerpt = renderedContent;
        })
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.articles = [];
        this.loading = false;
      }
    });
  }


  formatD(date: Date): string {
    return formatDate(date);
  }
}
