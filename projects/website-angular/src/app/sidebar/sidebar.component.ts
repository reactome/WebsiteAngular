import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { KeyValuePipe } from '@angular/common';
import { catchError, map, of, switchMap } from 'rxjs';
import { NavOptionsService } from '../../services/nav-options.service';
import { NavLink, NavOption, linkPath, linkQueryParams } from '../../types/link';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { ContentService } from '../../services/content.service';

/** What the sidebar shows for one address. */
interface SidebarNav {
  title: string;
  icon: string;
  items: Record<string, NavLink>;
  activeItem: string | null;
}

const EMPTY: SidebarNav = { title: '', icon: '', items: {}, activeItem: null };

/** A news or spotlight article, whose sidebar lists its siblings. */
interface ArticleList {
  path: 'about/news' | 'content/reactome-research-spotlight';
  slug: string;
}

function articleListFor(segments: string[]): ArticleList | null {
  const parent = segments.length >= 2 ? segments[segments.length - 2] : null;
  const slug = segments[segments.length - 1];
  if (parent === 'news') return { path: 'about/news', slug };
  if (parent === 'reactome-research-spotlight') {
    return { path: 'content/reactome-research-spotlight', slug };
  }
  return null;
}

/** The key of the item a page is on, by its link or its last segment. */
function findActiveItemKey(
  items: Record<string, NavLink>,
  lastSegment: string,
  segments: string[]
): string | null {
  const currentPath = '/' + segments.join('/');
  for (const [key, navLink] of Object.entries(items)) {
    if (navLink.link === currentPath) return key;
    const linkSegments = navLink.link.split('/').filter((s) => s);
    if (linkSegments[linkSegments.length - 1] === lastSegment) return key;
  }
  return null;
}

/** The sidebar for a page in the site navigation (not an article). */
function navFor(segments: string[], navOptions: Record<string, NavOption>): SidebarNav {
  // The first segment is the main section (about, documentation, content...).
  const section = segments.length > 0 ? navOptions[segments[0]] : undefined;
  if (!section) return EMPTY;

  const sectionDropdownLinks = section.dropdownLinks || {};

  // A section page itself (e.g. /about) lists the section's links.
  if (segments.length === 1) {
    return {
      title: section.label,
      icon: section.icon || '',
      items: sectionDropdownLinks,
      activeItem: null,
    };
  }

  // Match the second segment by the link's last segment, or by key: "userguide"
  // matches the link "/documentation/userguide".
  const secondSegment = segments[1];
  let matchedSubSection: NavLink | undefined;
  let matchedSubSectionKey: string | undefined;
  for (const [key, navLink] of Object.entries(sectionDropdownLinks)) {
    const linkSegments = navLink.link.split('/').filter((s) => s);
    if (linkSegments[linkSegments.length - 1] === secondSegment || key === secondSegment) {
      matchedSubSection = navLink;
      matchedSubSectionKey = key;
      break;
    }
  }

  // A sub-section with links of its own lists those.
  const nested = matchedSubSection?.dropdownLinks;
  if (nested && Object.keys(nested).length > 0) {
    let activeItem = findActiveItemKey(nested, segments[segments.length - 1], segments);
    // Deeper than that: the item whose own links contain this page.
    if (!activeItem && segments.length > 2) {
      const currentPath = '/' + segments.join('/');
      for (const [key, navLink] of Object.entries(nested)) {
        if (Object.values(navLink.dropdownLinks ?? {}).some((l) => l.link === currentPath)) {
          activeItem = key;
        }
      }
    }
    return { title: '', icon: '', items: nested, activeItem };
  }

  // Otherwise the section's links, with this sub-section marked.
  return {
    title: '',
    icon: '',
    items: sectionDropdownLinks,
    activeItem: matchedSubSectionKey || null,
  };
}

@Component({
  selector: 'app-sidebar',
  imports: [KeyValuePipe, MatIcon, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly linkPath = linkPath;
  readonly linkQueryParams = linkQueryParams;

  // "sections" mode: instead of route-driven peer navigation links, the
  // sidebar renders a caller-supplied list of in-page section anchors and
  // emits a click event for each. Used by entity detail pages to surface
  // the TOC of the embedded cr-description-tab on the left rail.
  readonly sectionsMode = input(false);
  readonly sections = input<{ key: string; label: string }[]>([]);
  readonly sectionsTitle = input('');
  readonly sectionsIcon = input('');
  readonly activeSectionKey = input('');
  readonly sectionSelected = output<string>();

  private readonly contentService = inject(ContentService);
  /** Shared, loaded once by NavOptionsService; starts empty. */
  private readonly navOptions = inject(NavOptionsService).navOptions;

  private readonly segments = toSignal(
    inject(ActivatedRoute).url.pipe(map((segments) => segments.map((s) => s.path))),
    { initialValue: [] as string[] }
  );

  private readonly articleList = computed(() => articleListFor(this.segments()), {
    equal: (a, b) => a?.path === b?.path && a?.slug === b?.slug,
  });

  /** The article index for an article page, fetched once per list. */
  private readonly articles = toSignal(
    toObservable(computed(() => this.articleList()?.path ?? null)).pipe(
      switchMap((path) =>
        path
          ? this.contentService.getAllArticles(path).pipe(
              catchError((err: unknown) => {
                console.error('Error loading articles:', err);
                return of([]);
              })
            )
          : of(null)
      )
    ),
    { initialValue: null }
  );

  /**
   * Everything the sidebar shows, derived from the address, the navigation
   * and the article index. It used to be assembled into plain fields from a
   * route subscription and an effect, with change detection requested by
   * hand; an article list arriving after that request changed the view after
   * Angular had checked it (NG0100), and the view could show a stale list.
   */
  readonly nav = computed<SidebarNav>(() => {
    if (this.sectionsMode()) return EMPTY;
    const list = this.articleList();
    if (!list) return navFor(this.segments(), this.navOptions());

    const items: Record<string, NavLink> = Object.fromEntries(
      (this.articles() ?? []).map((item) => [
        item.slug,
        { link: `/${list.path}/${item.slug}`, label: item.title },
      ])
    );
    return {
      title: list.path === 'about/news' ? 'News & Updates' : 'Reactome Research Spotlights',
      icon: '',
      items,
      activeItem: list.slug in items ? list.slug : null,
    };
  });

  // Sidebar drawer breakpoint -- below this, the sidebar overlays the
  // content as a slide-in drawer and starts collapsed so it doesn't bury
  // the page. Kept in sync with the @media query in sidebar.component.scss.
  private static readonly NARROW_BREAKPOINT_PX = 1024;
  readonly sidebarVisible = signal(
    typeof window !== 'undefined' ? window.innerWidth > SidebarComponent.NARROW_BREAKPOINT_PX : true
  );

  toggleSidebar() {
    this.sidebarVisible.update((visible) => !visible);
  }

  preserveOrder = () => 0;
}
