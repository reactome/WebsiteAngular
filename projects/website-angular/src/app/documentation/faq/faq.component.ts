import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentService } from 'projects/website-angular/src/services/content.service';

import type {
  ArticleIndexItem,
  FaqGroup,
  FaqIndex,
} from 'projects/website-angular/src/types/article';

/**
 * The FAQ: categories, each either a list of questions or tabs of them.
 *
 * All state is signals, and rendering only reads it. The page used to choose a
 * category's default tab while rendering -- asking whether a tab was active
 * wrote the default into the state the question list had already read -- which
 * a development build reports as NG0100 and a production build renders from a
 * value that changed underneath it.
 */
@Component({
  selector: 'app-faq',
  imports: [PageLayoutComponent, RouterLink],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss',
})
export class FaqComponent {
  // The service answers an empty index if the request fails.
  private readonly faqIndex = toSignal(inject(ContentService).getFaqIndex(), {
    initialValue: {} as FaqIndex,
  });

  readonly categories = computed(() => Object.keys(this.faqIndex()));

  /** Categories the reader has closed; every category starts open. */
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  /** Tabs the reader has chosen, by category; otherwise the first. */
  private readonly chosenTabs = signal<Readonly<Record<string, string>>>({});

  isCategoryExpanded(category: string): boolean {
    return !this.collapsed().has(category);
  }

  toggleCategory(category: string): void {
    const next = new Set(this.collapsed());
    if (next.has(category)) next.delete(category);
    else next.add(category);
    this.collapsed.set(next);
  }

  getSubcategories(category: string): string[] {
    return Object.keys(this.faqIndex()[category] ?? {}).filter((key) => key !== 'articles');
  }

  /** The tab showing for a category: the reader's choice, or the first. */
  activeTab(category: string): string | undefined {
    return this.chosenTabs()[category] ?? this.getSubcategories(category)[0];
  }

  setActiveTab(category: string, sub: string) {
    this.chosenTabs.update((tabs) => ({ ...tabs, [category]: sub }));
  }

  isActiveTab(category: string, sub: string): boolean {
    return this.activeTab(category) === sub;
  }

  getArticles(category: string, subcategory?: string): ArticleIndexItem[] {
    const entry = this.faqIndex()[category];
    const group = (subcategory ? entry?.[subcategory] : entry) as FaqGroup | undefined;
    return group?.articles ?? [];
  }

  formatName(name: string): string {
    return name.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
