import {
  Component,
  inject,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { SearchService } from 'projects/website-angular/src/services/search.service';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
})
export class SearchBarComponent implements OnChanges {
  private router = inject(Router);
  private searchService = inject(SearchService);
  @Input() query: string = '';
  @Output() queryChange = new EventEmitter<string>();

  suggestions: string[] = [];
  highlightedIndex: number = -1;
  

  showSuggestions = false;

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query = value;
    this.getSuggestions(this.query);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['suggestions']) {
      this.suggestions = this.suggestions ? [...this.suggestions] : [];
    }
    if (changes['query']) {
      this.query = this.query || '';
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    // Only submit if the query is not empty or whitespace
    this.showSuggestions = false;
    
    const q = this.query.trim();
    if (!q) {
      return;
    }
    this.router.navigate(['/content/query'], { queryParams: { q: q }});
    

    this.queryChange.emit(q);
  }

  hideTimeout?: number;

  hideDropdownDelayed(): void {
    this.hideTimeout = window.setTimeout(() => {
      this.showSuggestions = false;
    }, 150);
  }

  showDropdown(): void {
    clearTimeout(this.hideTimeout);
    this.showSuggestions = true;
  }

  selectSuggestion(s: string): void {
    this.showSuggestions = false;
    s = s.trim();
    if (!s) {
      return;
    }

    this.query = s;
    
    this.router.navigate(['/content/query'], { queryParams: { q: s } });
    this.queryChange.emit(s);
  }

  private getSuggestions(query: string): void {
      if (!query) {
        this.suggestions = [];
        return;
      }
      this.searchService.getSuggestedTerms(query).subscribe({
        next: (terms) => {
          this.suggestions = terms || [];
        },
        error: () => {
          this.suggestions = [];
        },
      });
    }
  
  @HostListener('window:keydown.arrowdown', ['$event'])
  onKeyDownArrowDown(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.suggestions.length > 0 && this.showSuggestions) {
      this.highlightedIndex = (this.highlightedIndex + 1) % this.suggestions.length;
    }
  }

  @HostListener('window:keydown.arrowup', ['$event'])
  onKeyDownArrowUp(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.suggestions.length > 0 && this.showSuggestions) {
      this.highlightedIndex = (this.highlightedIndex - 1 + this.suggestions.length) % this.suggestions.length;
    }
  }
}
