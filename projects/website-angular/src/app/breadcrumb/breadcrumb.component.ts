import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatIcon } from "@angular/material/icon";
import { mapNavOptions } from '../../utils/nav-options-mapper';
import {NavLink} from '../../types/link';
import { ContentService } from '../../services/content.service';

@Component({
  selector: 'app-breadcrumb',
  imports: [MatIcon],
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.scss'
})
export class BreadcrumbComponent {
  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);
  navOptions: Record<string, NavLink> = {};
  breadcrumbs: NavLink[] = [];

  ngOnInit() {
    //Get all nav options
    this.loadOptions();

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
