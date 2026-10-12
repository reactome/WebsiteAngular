import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ContentService } from '../../../services/content.service';
import { Article } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { LoadErrorComponent } from '../../reactome-components/load-error/load-error.component';
import { marked } from 'marked';
import addImageSizes from '../../../utils/addImageSizes';
import renderContentBody from '../../../utils/renderContentBody';
import rewriteContentUrls from '../../../utils/rewriteContentUrls';
import { StatsService } from '../../../services/stats.service';
import { applyRelease, needsRelease, releaseWithin } from '../../page/release-placeholder';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { IS_CURATOR } from '../../../../../pathway-browser/src/environments/environment';

@Component({
  selector: 'app-article',
  imports: [PageLayoutComponent, LoadErrorComponent, RouterLink],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
})
export class ArticleComponent implements OnInit {
  article: Article | null = null;
  renderedContent: SafeHtml = '';
  loading = true;
  notFound = false;
  failed = false;
  /** Where the article was looked for: 'about/news' or the spotlights. */
  private path = '';

  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);
  private sanitizer = inject(DomSanitizer);
  private stats = inject(StatsService);
  // The app is zoneless and these are plain fields, not signals, so nothing
  // notices them changing inside an HTTP callback -- and `await marked(...)`
  // resumes in a microtask, further detached from anything Angular watches.
  // Without this the page stays on "Loading article..." with the data already
  // in hand.
  private cdr = inject(ChangeDetectorRef);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.route.url.subscribe((segments) => {
        // Build the path from URL segments (e.g., about/userguide/pathway-browser)
        const path_segments = segments.map((s) => s.path);

        if (path_segments.length > 0 && path_segments) {
          if (path_segments.includes('about')) {
            this.loadArticle('about/news', slug);
          } else if (path_segments.includes('content')) {
            this.loadArticle('content/reactome-research-spotlight', slug);
          }
        }
      });
    }
  }

  loadArticle(path: string, slug: string) {
    this.loading = true;
    this.notFound = false;
    this.failed = false;
    this.article = null;
    this.path = path;

    this.contentService.getArticle(path, slug).subscribe({
      next: (article) => {
        if (!article) {
          this.notFound = true;
          this.loading = false;
          this.cdr.markForCheck();
          return;
        }
        // Callback kept synchronous: an async one hands a promise to code
        // that ignores it, so any rejection in here would vanish.
        void (async () => {
          let html = await marked(article.body || '');
          // The same URL handling as the content pages (see rewriteContentUrls).
          if (needsRelease(html)) {
            const release = await releaseWithin(this.stats.getVersion(), { skip: IS_CURATOR });
            if (release) html = applyRelease(html, release);
          }
          html = rewriteContentUrls(html);
          // Same reservation as the content pages. An article carries at most
          // four images where a userguide page carries 114, so nobody is thrown
          // thousands of pixels off here -- but the text still moves under a
          // reader while the images arrive, and the sizes are already staged.
          const renderedContent = addImageSizes(renderContentBody(html), article.imageSizes);
          this.renderedContent = this.sanitizer.bypassSecurityTrustHtml(renderedContent);

          this.article = { ...article, body: renderedContent };

          this.loading = false;
          this.cdr.markForCheck();
        })().catch((error) => {
          console.error('Could not render article', error);
          this.failed = true;
          this.loading = false;
          this.cdr.markForCheck();
        });
      },
      error: (err) => {
        this.failed = true;
        this.loading = false;
        console.error('Error loading article:', err);
        this.cdr.markForCheck();
      },
    });
  }

  /** The list the article would be in, for a reader whose article is not there. */
  listLink(): string {
    return '/' + this.path;
  }

  listName(): string {
    return this.path === 'about/news' ? 'news' : 'research spotlights';
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
