import { Component, inject, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss'
})
export class SearchBarComponent implements OnChanges {
  private router = inject(Router);
  @Input() query = '';
  @Input() suggestions: string[] = [];
  @Output() queryChange = new EventEmitter<string>();

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

  onSubmit(event: Event): void {
    event.preventDefault();
    const trimmed = this.query.trim();
    if (trimmed) {
      this.router.navigate(['/content/query'], { queryParams: { q: trimmed } });
    }
  }
}
