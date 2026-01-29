import { Component, inject, Input } from '@angular/core';
import { ArticleIndexItem } from '../../../types/article';
import { NgForOf, NgFor } from '@angular/common';
import formatDate from '../../../utils/formatDate';
import { ContentService } from '../../../services/content.service';
import NavOption from '../../../types/nav-option';
import { mapNavOptions } from '../../../utils/nav-options-mapper';

@Component({
  selector: 'app-home-latest-news',
  standalone: true,
  imports: [NgForOf, NgFor],
  templateUrl: './home-latest-news.component.html',
  styleUrl: './home-latest-news.component.scss'
})
export class HomeLatestNewsComponent {
  contentService = inject(ContentService);
  navOptions: Record<string, NavOption> = {};

  loading = true;
  newsList: ArticleIndexItem[] = [];

  ngOnInit() {
    this.loadNavOptions();
    this.loadLatestNews();
  }

  loadLatestNews() {
    this.loading = true;
    // Fetch all articles from TinaCMS GraphQL API
    this.contentService.getLatestArticles('about/news', 10).subscribe({
      next: (result) => {
        this.newsList = result.map((item: ArticleIndexItem) => ({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug,
          excerpt: item.excerpt
        } ));
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.newsList = [];
        this.loading = false;
      }
    });
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
