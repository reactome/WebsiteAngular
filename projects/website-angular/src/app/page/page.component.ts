import { ChangeDetectorRef, Component, ElementRef, inject, OnInit } from '@angular/core';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ContentService } from '../../services/content.service';
import { marked } from 'marked';
import addImageSizes from '../../utils/addImageSizes';
import renderContentBody from '../../utils/renderContentBody';
import sanitize from '../../utils/sanitize';
import { StatsService } from '../../services/stats.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ViewportScroller } from '@angular/common';
import loadHubspotMeetingsIfPresent from '../../utils/loadHubspotMeetingsIfPresent';
import { applyRelease, needsRelease, releaseWithin } from './release-placeholder';
import rewriteContentUrls from '../../utils/rewriteContentUrls';
import { IS_CURATOR } from '../../../../pathway-browser/src/environments/environment';

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
            if (needsRelease(html)) {
              const release = await releaseWithin(this.stats.getVersion(), { skip: IS_CURATOR });
              if (release) html = applyRelease(html, release);
            }
            html = rewriteContentUrls(html);
            // renderContentBody holds the chain every content body needs, and
            // why each step is there. `addImageSizes` last of the html steps, so it sees every `<img>`
            // the others produced. Without it a content image reserves no space
            // until it loads, and a reader who clicks a heading in the table of
            // contents is carried away from it as the images above arrive --
            // measured at 2,793px off on the FIViz page, which has 116.
            this.renderedContent = sanitize(
              addImageSizes(renderContentBody(html), this.page?.imageSizes),
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
