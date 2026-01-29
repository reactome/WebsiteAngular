import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ContentService } from '../../../services/content.service';
import { NewsArticle } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";

@Component({
  selector: 'app-news-article',
  imports: [CommonModule, PageLayoutComponent],
  templateUrl: './news-article.component.html',
  styleUrl: './news-article.component.scss'
})
export class NewsArticleComponent implements OnInit {
  article: NewsArticle | null = null;
  loading = true;
  error: string | null = null;

  private route =  inject(ActivatedRoute);
  private contentService = inject(ContentService);


  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.loadArticle(slug);
    }
  }

  loadArticle(slug: string) {
    this.loading = true;

    this.contentService.getNewsArticle(slug).subscribe({
      next: (article) => {
        this.article = {
          title: article?.title || 'Untitled',
          author: article?.author || 'Unknown',
          date: article?.date || new Date(),
          body: article?.body || '',
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
