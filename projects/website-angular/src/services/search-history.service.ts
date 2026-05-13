import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SearchHistoryService {
  // Last URL the user visited under /content/query (including its query
  // string), or the bare path if they've never been there in this session.
  // Used by the breadcrumb on entity detail pages so the "Search" link
  // round-trips users back to their results instead of an empty search.
  readonly lastSearchUrl = signal<string>('/content/query');
}
