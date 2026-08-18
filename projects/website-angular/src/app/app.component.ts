import { Component, HostListener, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ViewportScroller } from '@angular/common';
import { SearchHistoryService } from '../services/search-history.service';
import { NavigationBarComponent } from './navigation-bar/navigation-bar.component';
import { InfoFooterComponent } from './info-footer/info-footer.component';
import { copyrightFooterComponent } from './copyright-footer/copyright-footer.component';
import { CiteUsComponent } from './cite-us/cite-us.component';
import { ScrollToTopComponent } from './scroll-to-top/scroll-to-top.component';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { SUBJECT_ICONS } from '../utils/subjectIcons';
import { IS_CURATOR } from '../../../pathway-browser/src/environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    NavigationBarComponent,
    InfoFooterComponent,
    copyrightFooterComponent,
    CiteUsComponent,
    ScrollToTopComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private matIconRegistry = inject(MatIconRegistry);
  private domSanitizer = inject(DomSanitizer);

  title = 'WebsiteAngular';

  /**
   * The curator build has no site navigation: it is a tool, not the public
   * site. These were commented out of the template to achieve that, which
   * removed the header and the footer's links from the main site as well.
   * Gate on the variant instead, the way the pathway browser already does.
   */
  readonly isCurator = IS_CURATOR;

  private viewportScroller = inject(ViewportScroller);
  private router = inject(Router);
  private searchHistory = inject(SearchHistoryService);

  constructor() {
    // Capture the user's last /content/query URL (including ?q=, facets,
    // etc.) so the breadcrumb on entity detail pages can route them back
    // to their actual search state instead of an empty search form.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const url = (e as NavigationEnd).urlAfterRedirects;
      if (
        url === '/content/query' ||
        url.startsWith('/content/query?') ||
        url.startsWith('/content/query/')
      ) {
        this.searchHistory.lastSearchUrl.set(url);
      }
    });
  }

  ngOnInit(): void {
    this.matIconRegistry.registerFontClassAlias('symbols', 'material-symbols-rounded');

    // Register Reactome subject SVGs (Protein, Pathway, Complex, ...) so the
    // search results render the same icons as the pathway-browser. The SVGs
    // live in projects/pathway-browser/src/assets/icons/reactome-subject/ and
    // are served at /assets/icons/reactome-subject/<route>.svg via angular.json.
    const registered = new Set<string>();
    for (const icon of Object.values(SUBJECT_ICONS)) {
      if (registered.has(icon.name)) continue;
      registered.add(icon.name);
      this.matIconRegistry.addSvgIcon(
        icon.name,
        this.domSanitizer.bypassSecurityTrustResourceUrl(
          `assets/icons/reactome-subject/${icon.route}.svg`
        )
      );
    }
  }

  // Intercept hash-only anchor clicks so Angular's <base href="/"> doesn't
  // resolve them as navigations to /#anchor (which lands on the home page).
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('#') || href === '#') return;
    event.preventDefault();
    const id = href.substring(1);
    this.viewportScroller.scrollToAnchor(id);
    history.replaceState(null, '', `${location.pathname}${location.search}${href}`);
  }
}
