import {
  Component,
  inject,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
})
export class SearchBarComponent implements OnChanges {
  private router = inject(Router);
  @Input() query: string = '';
  @Input() suggestions: string[] = [];
  @Output() queryChange = new EventEmitter<string>();

  showSuggestions = false;

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query = value;
    this.queryChange.emit(value);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['suggestions']) {
      this.suggestions = this.suggestions ? [...this.suggestions] : [];
    }
  }

  ngOnInit(): void {
    const urlParams = this.router.parseUrl(this.router.url).queryParams;
    if (urlParams['q']) {
      console.log('Setting initial query from URL:', urlParams['q']);
      this.query = urlParams['q'];
    }
  }

  onSubmit(event: Event): void {
    // Only submit if the query is not empty or whitespace
    this.showSuggestions = false;
    this.queryChange.emit(this.query);
    if (this.query) {
      this.router.navigate(['/content/query'], {
        queryParams: { q: this.query },
      });
    }
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
    this.query = s;
    this.queryChange.emit(s);
    this.router.navigate(['/content/query'], { queryParams: { q: s } });
  }
}
