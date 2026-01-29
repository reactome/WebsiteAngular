import { Component, inject } from '@angular/core';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { ActivatedRoute } from '@angular/router';
import { ContentService } from '../../services/content.service';
import { marked } from 'marked';
import stripFirstH1 from '../../utils/stripFirstH1';

@Component({
  selector: 'app-page',
  imports: [PageLayoutComponent],
  templateUrl: './page.component.html',
  styleUrl: './page.component.scss'
})
export class PageComponent {
  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);

  page: any | null = null;
  renderedContent: string = '';
  loading = false;
  error: string | null = null;

  ngOnInit() {
     this.route.url.subscribe(segments => {
      if (segments.length === 0) {
        this.error = 'Page not found.';
        return;
      }

      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path = segments.map(s => s.path).join('/');
      // Strip the '{pageType}/' prefix since content is in content/{pageType}/
      if (path.startsWith(segments[0].path + '/')) {
        path = path.substring(segments[0].path.length + 1);
      } else if (path === segments[0].path) {
        path = 'index';
      }
      if (path) {
        this.loadPage(segments[0].path, path);
      }
    });
  }

  private async loadPage(pageType:string, slug: string) {
    this.loading = true;
    this.error = null;

    this.contentService.getPage(pageType, slug).subscribe({
      next: async (page) => {
        if (page) {
          this.page = page;
          let html = await marked(page.body);
          this.renderedContent = stripFirstH1(html);
          console.log("Page loaded:", page.body);
          this.loading = false;
        } else {
          this.error = 'Page not found.';
          this.loading = false;

        }
      }
      , error: (err) => {
        this.error = 'Error loading page.';
        this.loading = false;
        console.error("Issue Loading Page: ",err);
      }
    })
  }
}
