import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { KeyValuePipe, NgForOf } from '@angular/common';
import { mapNavOptions } from '../../utils/nav-options-mapper';
import {NavLink, NavOption} from '../../types/link';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIcon } from "@angular/material/icon";
import { ContentService } from '../../services/content.service';
import { ArticleIndexItem } from '../../types/article';

@Component({
  selector: 'app-sidebar',
  imports: [NgForOf, KeyValuePipe, MatIcon, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  // "sections" mode: instead of route-driven peer navigation links, the
  // sidebar renders a caller-supplied list of in-page section anchors and
  // emits a click event for each. Used by entity detail pages to surface
  // the TOC of the embedded cr-description-tab on the left rail.
  @Input() sectionsMode = false;
  @Input() sections: { key: string; label: string }[] = [];
  @Input() sectionsTitle = '';
  @Input() sectionsIcon = '';
  @Input() activeSectionKey = '';
  @Output() sectionSelected = new EventEmitter<string>();
  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);
  navOptions: Record<string, NavOption> = {};

  sectionTitle = '';
  sectionIcon = '';
  sectionLink = '';
  items: Record<string, NavOption> = {};
  activeItem: string | null = null;

  // Sidebar drawer breakpoint -- below this, the sidebar overlays the
  // content as a slide-in drawer and starts collapsed so it doesn't bury
  // the page. Kept in sync with the @media query in sidebar.component.scss.
  private static readonly NARROW_BREAKPOINT_PX = 1024;
  sidebarVisible: boolean = typeof window !== 'undefined'
    ? window.innerWidth > SidebarComponent.NARROW_BREAKPOINT_PX
    : true;

  ngOnInit() {
    // Sections mode is fully controlled by inputs; no route-based loading.
    if (this.sectionsMode) return;
    //Get all nav options
    this.loadOptions();

    this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        //If 2nd last item is news or reactome-research-spotlight, load articles as items
        const secondLastSegment = path_segments.length >=2 ? path_segments[path_segments.length - 2] : null;
        if (secondLastSegment === 'news') {
          this.updateItemsArticles('about/news', path_segments[path_segments.length -1]);
        } else if (secondLastSegment === 'reactome-research-spotlight') {
          this.updateItemsArticles('content/reactome-research-spotlight', path_segments[path_segments.length -1]);
        } else {
          this.updateItems(path_segments);
        }
      }
    });
  }

  loadOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  updateItems(segments: string[]) {
    // Wait for navOptions to be loaded
    if (Object.keys(this.navOptions).length === 0) {
      // Retry after navOptions are loaded
      setTimeout(() => this.updateItems(segments), 50);
      return;
    }

    // First segment is the main section (about, documentation, content, etc.)
    const mainSection = segments[0];

    if (!this.navOptions[mainSection]) {
      this.items = {};
      return;
    }

    const section = this.navOptions[mainSection];

    // If only one segment (e.g., /about), show the section's dropdown links
    if (segments.length === 1) {
      this.sectionTitle = section.label;
      this.sectionIcon = section.icon || '';
      this.sectionLink = section.link;
      
      this.items = section.dropdownLinks || {};
      this.activeItem = null;
      return;
    }

    // For nested routes, check if the second segment has its own dropdown links
    const secondSegment = segments[1];
    const sectionDropdownLinks = section.dropdownLinks || {};

    // Find the matching dropdown link for the second segment
    // Need to match by link path, not key (e.g., "userguide" matches link "/documentation/userguide")
    let matchedSubSection: NavLink | undefined;
    let matchedSubSectionKey: string | undefined;

    for (const [key, navLink] of Object.entries(sectionDropdownLinks)) {
      // Check if the link ends with the segment or if the key matches
      const linkSegments = navLink.link.split('/').filter(s => s);
      if (linkSegments[linkSegments.length - 1] === secondSegment || key === secondSegment) {
        matchedSubSection = navLink;
        matchedSubSectionKey = key;
        break;
      }
    }

    // If the matched subsection has its own dropdown links, show those
    if (matchedSubSection?.dropdownLinks && Object.keys(matchedSubSection.dropdownLinks).length > 0) {
      this.items = matchedSubSection.dropdownLinks;
      
      // Find active item within the nested dropdown links
      // For deeply nested routes, we need to find the item that matches any of the remaining segments
      const lastSegment = segments[segments.length - 1];
      this.activeItem = this.findActiveItemKey(matchedSubSection.dropdownLinks, lastSegment, segments);
      
      // If we didn't find an active item and there are 3+ segments,
      // check if any of the matched subsection's items are parents of the current route
      if (!this.activeItem && segments.length > 2) {
        for (const [key, navLink] of Object.entries(matchedSubSection.dropdownLinks)) {
          if (navLink.dropdownLinks) {
            // Check if current route is within this item's nested links
            const currentPath = '/' + segments.join('/');
            for (const nestedLink of Object.values(navLink.dropdownLinks)) {
              if (nestedLink.link === currentPath) {
                this.activeItem = key;
                break;
              }
            }
          }
        }
      }
    } else {
      // Otherwise, show the parent section's dropdown links
      this.items = sectionDropdownLinks;
      this.activeItem = matchedSubSectionKey || null;
    }
  }

  updateItemsArticles(path: string, currentSlug: string) {
    if (path.includes('news')) {
      this.sectionTitle = "News & Updates";
      this.sectionLink = this.navOptions['about']?.dropdownLinks?.['news']?.link || '';
    } else {
      this.sectionTitle = "Reactome Research Spotlights";
      this.sectionLink = this.navOptions['content']?.dropdownLinks?.['reactome-research-spotlight']?.link || '';
    }

    this.contentService.getAllArticles(path).subscribe({
      next: (result) => {
        this.items = Object.fromEntries(result.map((item: ArticleIndexItem) => {
          if (item.slug == currentSlug) {
            this.activeItem = item.slug;
          }

          const key = item.slug;
          const navLink: NavLink = {
            link: `/${path}/${item.slug}`,
            label: item.title
          };
          return [key, navLink];
        }));

      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.items = {};
      }
    });
  }

  /**
   * Find the key of the active item based on the current route segments
   */
  private findActiveItemKey(items: Record<string, NavLink>, lastSegment: string, segments: string[]): string | null {
    const currentPath = '/' + segments.join('/');
    
    for (const [key, navLink] of Object.entries(items)) {
      // Check if the link matches the current path
      if (navLink.link === currentPath) {
        return key;
      }
      
      // Check if the link ends with the last segment
      const linkSegments = navLink.link.split('/').filter(s => s);
      if (linkSegments[linkSegments.length - 1] === lastSegment) {
        return key;
      }
    }
    
    return null;
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
  }

  // Normalize a nav link to an absolute path. Some nav-options.json entries
  // (notably the about/* items) are stored as relative paths (no leading
  // slash). A relative routerLink resolves against the current route and
  // accumulates segments (e.g. on /about/team it becomes
  // /about/team/about/news), so force a leading slash here.
  toAbsoluteLink(link: string | undefined | null): string {
    if (!link) return '/';
    return link.startsWith('/') ? link : '/' + link;
  }

   preserveOrder = () => 0;
}
