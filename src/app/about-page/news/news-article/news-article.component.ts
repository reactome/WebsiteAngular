import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

interface ArticleData {
  title: string;
  content: string;
  datePublished: string;
  link: string;
  author?: string;
  tags?: string[];
}

@Component({
  selector: 'app-news-article',
  imports: [CommonModule, HttpClientModule],
  templateUrl: './news-article.component.html',
  styleUrl: './news-article.component.scss'
})
export class NewsArticleComponent implements OnInit {
  article: ArticleData | null = null;
  loading = true;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient
  ) {}

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.loadArticle(slug);
    }
  }

  loadArticle(slug: string) {
    this.http.get<ArticleData[]>('/content/news/index.json').subscribe({
      next: (articles) => {
        const article = articles.find(a => a.link === slug);
        if (article) {
          this.article = article;
        } else {
          this.error = 'Article not found';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load article:', err);
        this.error = 'Failed to load article';
        this.loading = false;
      }
    });
  }
}
