import { Component, inject } from '@angular/core';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";
import { TileComponent } from "../../reactome-components/tile/tile.component";
import { ContentService  } from '../../../services/content.service';
import { NewsIndexItem } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { MatIcon } from "@angular/material/icon";


@Component({
  selector: 'app-news-page',
  imports: [PageLayoutComponent, TileComponent, MatIcon],
  templateUrl: './news-page.component.html',
  styleUrl: './news-page.component.scss'
})
export class NewsPageComponent {
    private contentService = inject(ContentService);

    articles: NewsIndexItem[] = [];
    loading = true;

    ngOnInit() {
      this.loadNews();
    }

    private loadNews() {
    this.loading = true;
    // Fetch all news from TinaCMS GraphQL API
    this.contentService.getAllNews().subscribe({
      next: (result) => {
        this.articles = result.map((item: NewsIndexItem) => ({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug
        } ));
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading news from TinaCMS:', err);
        this.articles = [];
        this.loading = false;
      }
    });
  }


  formatD(date: Date): string {
    return formatDate(date);
  }
}
