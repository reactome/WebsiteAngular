import { Component, inject } from '@angular/core';
import { PageLayoutComponent } from "../../page-layout/page-layout.component";
import { ContentService } from 'projects/website-angular/src/services/content.service';

@Component({
  selector: 'app-faq',
  imports: [PageLayoutComponent],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss'
})
export class FaqComponent {
  contentService = inject(ContentService);

  categories:string[] = [];
  faqIndex: Record<string, any> = {};

  ngOnInit() {
    this.contentService.getFaqIndex().subscribe({
      next: async (result) => {
        this.faqIndex = result;
        this.categories = Object.keys(result);
        console.log('FAQ Index:', this.faqIndex, "\nCategories:", this.categories);
      },
      error: (err) => {
        console.error('Error fetching FAQ index:', err);
      }
    });
  }
}
