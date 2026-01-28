import { Component, inject } from '@angular/core';
import { KeyValuePipe, NgForOf } from '@angular/common';
import { mapNavOptions } from '../../utils/nav-options-mapper';
import NavOption from '../../types/nav-option';
import NavLink from '../../types/nav-link';
import { ActivatedRoute } from '@angular/router';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-sidebar',
  imports: [NgForOf, KeyValuePipe, MatIcon],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  private route = inject(ActivatedRoute);
  navOptions: Record<string, NavOption> = {};

  sectionTitle = '';
  sectionIcon = '';
  sectionLink = '';
  items: Record<string, NavOption> = {};
  activeItem: string | null = null;

  sidebarVisible: boolean = true;

  ngOnInit() {
    //Get all nav options
    this.loadOptions();

    this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        this.updateItems(path_segments);
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
      const lastSegment = segments[segments.length - 1];
      this.activeItem = this.findActiveItemKey(matchedSubSection.dropdownLinks, lastSegment, segments);
    } else {
      // Otherwise, show the parent section's dropdown links
      this.items = sectionDropdownLinks;
      this.activeItem = matchedSubSectionKey || null;
    }
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

   preserveOrder = () => 0;
}
