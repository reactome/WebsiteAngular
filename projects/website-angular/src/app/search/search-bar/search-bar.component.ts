import { Component, inject, Input } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss'
})
export class SearchBarComponent {
  private router = inject(Router);
  @Input() query = '';

  onInput(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    const trimmed = this.query.trim();
    if (trimmed) {
      this.router.navigate(['/content/query'], { queryParams: { q: trimmed } });
    }
  }
}
