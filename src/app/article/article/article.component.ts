import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ContentService } from '../../../services/content.service';
import { Article } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";
import { marked } from 'marked';
import stripFirstH from '../../../utils/stripFirstH';

@Component({
  selector: 'app-article',
  imports: [CommonModule, PageLayoutComponent],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss'
})
export class ArticleComponent implements OnInit {
  article: Article | null = null;
  loading = true;
  error: string | null = null;

  private route =  inject(ActivatedRoute);
  private contentService = inject(ContentService);


  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.route.url.subscribe(segments => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      let path_segments = segments.map(s => s.path);

      if (path_segments.length > 0 && path_segments) {
        if (path_segments.includes('about')) {
          this.loadArticle('about/news', slug);

        } else if (path_segments.includes('content')) {
          this.loadArticle('content/reactome-research-spotlight', slug);
        }
      }
    });
    }
  }

  loadArticle(path: string, slug: string) {
    this.loading = true;

    this.contentService.getArticle(path,slug).subscribe({
      next: async (article) => {
        let html = await marked(article?.body || '');
        let renderedContent = stripFirstH(html);

        this.article = {
          title: article?.title || '',
          author: article?.author || '',
          date: article?.date || new Date(),
          body: renderedContent,
          slug: slug,
          image: article?.image,
          tags: article?.tags
        };
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Error loading article.';
        this.loading = false;
        console.error('Error loading article:', err);
      }
    })
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
