import { ChangeDetectorRef, Component, ElementRef, inject, OnInit } from '@angular/core';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ContentService } from '../../services/content.service';
import { marked } from 'marked';
import stripFirstH from '../../utils/stripFirstH';
import addAnchorIds from '../../utils/addAnchorIds';
import addJumpCards from '../../utils/addJumpCards';
import wrapCodeBlocks from '../../utils/wrapCodeBlocks';
import sanitize from '../../utils/sanitize';
import { StatsService } from '../../services/stats.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ViewportScroller } from '@angular/common';
import loadHubspotMeetingsIfPresent from '../../utils/loadHubspotMeetingsIfPresent';

@Component({
  selector: 'app-page',
  imports: [PageLayoutComponent, RouterLink],
  templateUrl: './page.component.html',
  styleUrl: './page.component.scss',
})
export class PageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);
  private sanitizer = inject(DomSanitizer);
  private stats = inject(StatsService);
  private elementRef = inject(ElementRef);
  private viewportScroller = inject(ViewportScroller);
  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);

  page: any | null = null;
  renderedContent: SafeHtml = '';
  loading = false;
  error: string | null = null;
  // A page that was never migrated is not the same as a page that failed to
  // load, and saying "Error loading page" for both reads as a server fault for
  // what is simply a URL we do not have.
  notFound = false;
  requestedPath = '';

  // Landing directly on e.g. /documentation/userguide/reactome-fiviz#Overview
  // can't be left to the router: the body arrives from an HTTP request well
  // after navigation completes, so at the moment the router would scroll there
  // is no element with that id yet. Re-try the scroll once the content has
  // actually been rendered.
  private scrollToRequestedAnchor(): void {
    const fragment = this.route.snapshot.fragment;
    if (fragment) this.viewportScroller.scrollToAnchor(fragment);
  }

  /**
   * Whether this page's body names a release, and so has to wait for one.
   *
   * Checked before awaiting so that the overwhelming majority of pages -- which
   * mention no release at all -- render without waiting on the content service.
   */
  private needsRelease(html: string) {
    return /\{release\}|download\.reactome\.org\/\d+\//.test(html);
  }

  /**
   * Point release artefacts at the release the database is serving.
   *
   * Authors write `{release}`; this substitutes it. A hardcoded number in a
   * bucket path is rewritten too, because that is how the statistics page came
   * to embed release 95's figures while the site served 97 -- the number was
   * typed into the content once and nothing brings it forward. Everything under
   * the versioned bucket is republished per release, so the current one is
   * always the right answer.
   */
  private applyRelease(html: string, release: string): string {
    return html
      .replace(/\{release\}/g, release)
      .replace(
        /(download\.reactome\.org\/)\d+(\/)/g,
        (_match, before, after) => `${before}${release}${after}`
      );
  }

  private rewriteContentUrls(html: string): string {
    return html.replace(
      /\b(href|src)=("([^"]*)"|'([^']*)')/g,
      (_match, attr, _quoted, doubleQuoted, singleQuoted) => {
        const value = doubleQuoted ?? singleQuoted ?? '';
        return `${attr}="${this.normalizeContentUrl(value)}"`;
      }
    );
  }

  private normalizeContentUrl(url: string): string {
    const reactomeUrlMatch = url.match(/^https?:\/\/(?:www\.)?reactome\.org\/?(.*)$/i);
    if (reactomeUrlMatch) {
      return reactomeUrlMatch[1].replace(/^\//, '');
    }

    if (url.startsWith('/')) {
      return url.replace(/^\/+/, '');
    }

    return url;
  }

  ngOnInit() {
    this.route.url.subscribe((segments) => {
      if (segments.length === 0) {
        this.notFound = true;
        this.cdr.markForCheck();
        return;
      }

      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path = segments.map((s) => s.path).join('/');
      this.requestedPath = path;
      // Strip the '{pageType}/' prefix since content is in content/{pageType}/
      if (path.startsWith(segments[0].path + '/')) {
        path = path.substring(segments[0].path.length + 1);
      } else if (path === segments[0].path) {
        path = 'index';
      }
      if (path) {
        // loadPage reports its own failures through the subscribe error handler.
        void this.loadPage(segments[0].path, path);
      }
    });
  }

  private async loadPage(pageType: string, slug: string) {
    this.loading = true;
    this.error = null;

    this.contentService.getPage(pageType, slug).subscribe({
      next: (page) => {
        // Callback kept synchronous: an async one hands a promise to code
        // that ignores it, so any rejection in here would vanish.
        void (async () => {
          if (page) {
            this.page = page;
            let html = await marked(page.body);
            if (this.needsRelease(html)) {
              html = this.applyRelease(html, await this.stats.getVersion());
            }
            html = this.rewriteContentUrls(html);
            // Keep this chain intact. Each step was added by a specific fix and
            // the imports alone do nothing: wrapCodeBlocks collapses long code
            // blocks (#98), addJumpCards builds the dev-page cards, and
            // addAnchorIds gives headings the ids that same-page "#" links --
            // including the table of contents at the top of the long userguide
            // pages -- need to jump to (#89). Dropping the calls but keeping the
            // imports is exactly how those regressed once already.
            this.renderedContent = sanitize(
              stripFirstH(addAnchorIds(addJumpCards(wrapCodeBlocks(html)))),
              this.sanitizer
            );
            this.loading = false;
            // `await marked(...)` resumes in a microtask, so this assignment is
            // detached from the subscribe callback as far as Angular is
            // concerned -- without this the rendered body never appears.
            this.cdr.markForCheck();
            // Let Angular flush the bound innerHTML before we look for
            // third-party embed placeholders inside it, or for the anchor a
            // deep link asked for.
            setTimeout(() => {
              loadHubspotMeetingsIfPresent(this.elementRef.nativeElement);
              this.scrollToRequestedAnchor();
            }, 0);
          } else {
            this.notFound = true;
            this.loading = false;
            this.cdr.markForCheck();
          }
        })().catch((error) => console.error('Could not render page content', error));
      },
      error: (err: unknown) => {
        // Content is compiled to one JSON file per page, so "this page does not
        // exist" arrives as a 404 on that file rather than as a null body --
        // which is why the null branch above never fires for a missing page.
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.notFound = true;
        } else {
          this.error = 'Error loading page.';
          console.error('Issue Loading Page: ', err);
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
