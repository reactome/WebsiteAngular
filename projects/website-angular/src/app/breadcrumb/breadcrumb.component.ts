import { Component, inject, effect, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIcon } from "@angular/material/icon";
import { NavOptionsService } from '../../services/nav-options.service';
import {NavLink} from '../../types/link';
import { ContentService } from '../../services/content.service';
import { SearchHistoryService } from '../../services/search-history.service';
import { CONTENT_SERVICE } from '../../../../pathway-browser/src/environments/environment';

// Breadcrumb entries used by this component carry an optional set of
// query params so a link can preserve query-string state (notably the
// Search crumb, which routes back to /content/query?q=...).
interface BreadcrumbEntry extends NavLink {
  queryParams?: Record<string, string>;
}

@Component({
  selector: 'app-breadcrumb',
  imports: [MatIcon, RouterLink],
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.scss'
})
export class BreadcrumbComponent {
  private route = inject(ActivatedRoute);
  // These components build their state into plain fields from route
  // subscriptions and an effect, so Angular is not told when it changes.
  private cdr = inject(ChangeDetectorRef);
  private contentService = inject(ContentService);
  private http = inject(HttpClient);
  private searchHistory = inject(SearchHistoryService);
  readonly navOptions = inject(NavOptionsService).navOptions;

  /** Last segments seen, so the effect can rebuild once navOptions resolves. */
  private lastSegments: string[] | null = null;

  constructor() {
    effect(() => {
      if (Object.keys(this.navOptions()).length === 0) return;
      if (this.lastSegments) this.updateBreadcrumbs(this.lastSegments);
    });
  }
  breadcrumbs: BreadcrumbEntry[] = [];

  ngOnInit() {
    //Get all nav options

    this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        let second_lastSegment = path_segments.length >=2 ? path_segments[path_segments.length - 1] : null;

        if (second_lastSegment === 'news' || second_lastSegment === 'reactome-research-spotlight') {
          this.updateBreadcrumbs(path_segments.slice(0, path_segments.length -1));
          
          //wait for breadcrumbs to update before adding article title
          if (this.breadcrumbs.length === 0) {
            setTimeout(() => {
              this.updateBreadcrumbs(path_segments.slice(0, path_segments.length -1));
            }, 50);
          }
          
          let articleSegment = path_segments[path_segments.length -1];
           this.contentService.getArticleIndexItem(
            second_lastSegment === 'news' ? 'about/news' : 'content/reactome-research-spotlight',
            articleSegment).subscribe({
              next: (article) => {
                if (article) {
                  this.breadcrumbs.push({
                    label: article.title,
                    link: path_segments.join('/')
                  });
                }
              },
              error: (err) => {
                console.error("Error loading article for breadcrumb:", err);
                this.updateBreadcrumbs(path_segments);
              }
            })
        } else if (path_segments[0] === 'content' && path_segments[1] === 'detail' && path_segments[2] === 'person' && path_segments.length >= 4) {
          // Person profile page (/content/detail/person/:id where id is
          // ORCID or numeric dbId). Resolve to displayName via the
          // ContentService person endpoint which accepts both forms.
          this.breadcrumbs = [{ label: 'Search', link: '/content/query' }];
          const id = path_segments[3];
          const fullPath = '/' + path_segments.join('/');
          this.appendLeafBreadcrumb(id, fullPath);
          this.http.get<{ displayName?: string }>(
            `${CONTENT_SERVICE}/data/person/${id}`,
          ).subscribe({
            next: (p) => {
              if (p?.displayName) this.replaceLeafBreadcrumb(p.displayName, fullPath);
            },
          });
        } else if (path_segments[0] === 'content' && path_segments[1] === 'detail' && path_segments.length >= 3) {
          // Entity detail page (/content/detail/:id) -- /content and
          // /content/detail aren't landing pages, so we surface the search
          // page as the canonical parent: "Home > Search > <entity>". The
          // Search link round-trips to whatever search URL the user last
          // visited (preserving ?q= etc.), so they don't land on an empty
          // search form. The leaf starts as the raw stId and is replaced
          // with the entity displayName once /data/query/{id} responds.
          const { path: searchPath, queryParams: searchQueryParams } =
            this.splitUrl(this.searchHistory.lastSearchUrl());
          this.breadcrumbs = [
            { label: 'Search', link: searchPath, queryParams: searchQueryParams },
          ];
          const id = path_segments[2];
          const fullPath = '/' + path_segments.join('/');
          this.appendLeafBreadcrumb(id, fullPath);
          this.http.get<{ displayName?: string; name?: string[] }>(
            `${CONTENT_SERVICE}/data/query/${id}`,
          ).subscribe({
            next: (entity) => {
              const label = entity?.displayName || entity?.name?.[0] || id;
              this.replaceLeafBreadcrumb(label, fullPath);
            },
          });
        } else if (path_segments.includes('faq') && path_segments.length > 2) { //In in an FAQ page, but not the main FAQ page
          //Remove all segements after 'faq' and before the last segment (which is the question)
          let faqIndex = path_segments.indexOf('faq');
          let modifiedSegments = [...path_segments];
          modifiedSegments.splice(faqIndex + 1, modifiedSegments.length - faqIndex - 2);
          this.updateBreadcrumbs(modifiedSegments);
        } else {
          this.updateBreadcrumbs(path_segments);
        }
        
      }
    });
  }

  updateBreadcrumbs(segments: string[]) {
    // navOptions arrives asynchronously; the effect in the constructor rebuilds
    // these once it does, so there is no need to poll for it here.
    this.lastSegments = segments;
    if (Object.keys(this.navOptions()).length === 0) return;

    this.breadcrumbs = [];
    let currentPath = '';
    let currentNavLevel: Record<string, NavLink> = this.navOptions();

    for (const segment of segments) {
      currentPath += '/' + segment;

      // First, try to look up the nav link directly by segment key
      let matchedLink = currentNavLevel[segment];
      
      // If not found by key, search through all items at current level to find matching link
      if (!matchedLink) {
        for (const navLink of Object.values(currentNavLevel)) {
          if (navLink.link === currentPath) {
            matchedLink = navLink;
            break;
          }
        }
      }

      if (matchedLink) {
        // Use currentPath (always absolute, built from URL segments) rather
        // than matchedLink.link, which may be stored as a relative path in
        // nav-options.json. A relative routerLink resolves against the
        // current route and duplicates segments (e.g. /about/x/about/x).
        this.breadcrumbs.push({
          label: matchedLink.label,
          link: currentPath
        });

        // Move to the next level of dropdown links if they exist
        currentNavLevel = matchedLink.dropdownLinks || {};
      } else {
        // If no match found, create a breadcrumb from the segment name
        this.breadcrumbs.push({
          label: this.formatSegmentLabel(segment),
          link: currentPath
        });
        currentNavLevel = {};
      }
    }
      this.cdr.markForCheck();
  }

  /**
   * Append a leaf entry to breadcrumbs after updateBreadcrumbs() finishes
   * (it can be deferred while it polls for navOptions). Without this guard
   * an immediate push gets clobbered when the deferred update resolves.
   */
  private appendLeafBreadcrumb(label: string, link: string) {
    if (Object.keys(this.navOptions).length === 0) {
      setTimeout(() => this.appendLeafBreadcrumb(label, link), 50);
      return;
    }
    if (this.breadcrumbs[this.breadcrumbs.length - 1]?.link !== link) {
      this.breadcrumbs.push({ label, link });
    }
  }

  private replaceLeafBreadcrumb(label: string, link: string) {
    if (Object.keys(this.navOptions).length === 0) {
      setTimeout(() => this.replaceLeafBreadcrumb(label, link), 50);
      return;
    }
    const last = this.breadcrumbs[this.breadcrumbs.length - 1];
    if (last?.link === link) {
      this.breadcrumbs[this.breadcrumbs.length - 1] = { label, link };
    } else {
      this.breadcrumbs.push({ label, link });
    }
  }

  /**
   * Split a (possibly query-stringed) relative URL into a path + a params
   * record so it can be fed into Angular's [routerLink] + [queryParams].
   * RouterLink doesn't accept query strings embedded in the link string.
   */
  private splitUrl(url: string): { path: string; queryParams?: Record<string, string> } {
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return { path: url };
    const path = url.substring(0, qIdx);
    const params = new URLSearchParams(url.substring(qIdx + 1));
    const queryParams: Record<string, string> = {};
    params.forEach((v, k) => { queryParams[k] = v; });
    return { path, queryParams };
  }

  /**
   * Format a URL segment into a readable label (e.g., "why-reactome" -> "Why Reactome")
   */
  private formatSegmentLabel(segment: string): string {
    return segment
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

}
