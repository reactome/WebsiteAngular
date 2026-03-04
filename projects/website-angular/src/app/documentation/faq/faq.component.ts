import { Component, inject } from '@angular/core';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentService } from 'projects/website-angular/src/services/content.service';
import { NgFor } from '@angular/common';
import { ArticleIndexItem } from 'projects/website-angular/src/types/article';

@Component({
  selector: 'app-faq',
  imports: [PageLayoutComponent, NgFor],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss',
})
export class FaqComponent {
  contentService = inject(ContentService);

  categories: string[] = [];
  faqIndex: Record<string, any> = {};
  activeTabs: Record<string, string> = {};

  ngOnInit() {
    this.contentService.getFaqIndex().subscribe({
      next: async (result) => {
        this.faqIndex = result;
        this.categories = Object.keys(result);
        console.log(
          'FAQ Index:',
          this.faqIndex,
          '\nCategories:',
          this.categories
        );
      },
      error: (err) => {
        console.error('Error fetching FAQ index:', err);
      },
    });
  }

  setActiveTab(category: string, sub: string) {
    this.activeTabs[category] = sub;
  }

  isActiveTab(category: string, sub: string): boolean {
    if (!this.activeTabs[category]) {
      // default to first subcategory
      this.activeTabs[category] = this.getSubcategories(category)[0];
    }
    return this.activeTabs[category] === sub;
  }

  getSubcategories(category: string): string[] {
    // console.log(Object.keys(this.faqIndex[category] || []));
    return Object.keys(this.faqIndex[category] || []);
  }

  getArticles(category: string, subcategory?: string): ArticleIndexItem[] {
    //Articles array is stored in record["articles"]
    const record = subcategory
      ? this.faqIndex[category][subcategory]
      : this.faqIndex[category];
    console.log(
      `Getting articles for category: ${category}, subcategory: ${subcategory}`,
      record
    );
    return record['articles'] || [];
  }

  formatName(name: string): string {
    return name
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
