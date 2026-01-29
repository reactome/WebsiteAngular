import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatIcon } from "@angular/material/icon";
import { mapNavOptions } from '../../utils/nav-options-mapper';
import {NavLink} from '../../types/link';

@Component({
  selector: 'app-breadcrumb',
  imports: [MatIcon],
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.scss'
})
export class BreadcrumbComponent {
  private route = inject(ActivatedRoute);
  navOptions: Record<string, NavLink> = {};
  breadcrumbs: NavLink[] = [];

  ngOnInit() {
    //Get all nav options
    this.loadOptions();

    this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        this.updateBreadcrumbs(path_segments);
      }
    });
  }

  loadOptions() {
      // Load nav options from the JSON file
      import('../../config/nav-options.json').then((data) => {
        this.navOptions = mapNavOptions(data.default);
      });
    }

  updateBreadcrumbs(segments: string[]) {
    // Wait for navOptions to be loaded
    if (Object.keys(this.navOptions).length === 0) {
      // Retry after navOptions are loaded
      setTimeout(() => this.updateBreadcrumbs(segments), 50);
      return;
    }

    this.breadcrumbs = [];
    let currentPath = '';
    let currentNavLevel: Record<string, NavLink> = this.navOptions;

    for (const segment of segments) {
      currentPath += '/' + segment;

      // Look up the nav link directly by segment key
      const matchedLink = currentNavLevel[segment];

      if (matchedLink) {
        this.breadcrumbs.push({
          label: matchedLink.label,
          link: matchedLink.link
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
