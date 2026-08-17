import { NavOptionsService } from '../../../services/nav-options.service';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ArticleIndexItem } from '../../../types/article';

import { RouterModule } from '@angular/router';
import formatDate from '../../../utils/formatDate';
import { ContentService } from '../../../services/content.service';

@Component({
  selector: 'app-home-latest-news',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './home-latest-news.component.html',
  styleUrl: './home-latest-news.component.scss',
})
export class HomeLatestNewsComponent implements OnInit {
  contentService = inject(ContentService);
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;

  private cdr = inject(ChangeDetectorRef);

  loading = true;
  newsList: ArticleIndexItem[] = [];

  /** Where the news index lives, per the nav config, with a sane fallback. */
  newsRoot(): string {
    return this.navOptions()['about']?.dropdownLinks?.['news']?.link || '/about/news';
  }

  /**
   * The release version a headline announces, if it announces one.
   *
   * Reactome ships numbered releases ("V96 Released") between publications and
   * announcements, and that difference is the only real structure in this list.
   * Matching is deliberately narrow: anything that is not clearly a version gets
   * a plain marker rather than a wrong one.
   */
  releaseOf(title: string): string | null {
    return /^\s*(V\d+)\b/i.exec(title)?.[1]?.toUpperCase() ?? null;
  }

  /**
   * One line of context for the lead item.
   *
   * Excerpts are raw markdown -- headings, images, link syntax -- so this strips
   * to plain prose and gives up rather than printing markup at a reader.
   */
  summaryOf(article: ArticleIndexItem): string | null {
    let text = (article.excerpt ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Excerpts usually open with the title again as a heading; printing it
    // directly under the headline just reads as a stutter.
    const title = article.title.trim();
    if (title && text.toLowerCase().startsWith(title.toLowerCase())) {
      text = text.slice(title.length).replace(/^[\s:.\u2013\u2014-]+/, '');
    }
    return text.length > 20 ? text : null;
  }

  ngOnInit() {
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
          excerpt: item.excerpt,
        }));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.newsList = [];
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
