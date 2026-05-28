import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, of, switchMap, take } from 'rxjs';
import MiniSearch from 'minisearch';
import { SiteSearchIndexItem } from '../types/site-search';

export interface SitePageHit extends SiteSearchIndexItem {
  score: number;
}

// Loads the static /site-search-index.json once, lazily builds a MiniSearch
// index over the CMS pages, and exposes a single search() method. Used by the
// unified search page to merge page hits into the Solr results as a "Pages"
// group alongside Protein / Pathway / Complex / etc.
@Injectable({ providedIn: 'root' })
export class SiteSearchService {
  private http = inject(HttpClient);

  private index$ = new ReplaySubject<MiniSearch<SiteSearchIndexItem>>(1);
  private loaded = false;

  search(query: string, limit = 25): Observable<SitePageHit[]> {
    if (!this.loaded) {
      this.loaded = true;
      this.loadIndex();
    }
    const trimmed = query.trim();
    if (!trimmed) return of([]);
    // take(1) so the returned observable completes after the first emission.
    // Without it, forkJoin in the consumer would wait forever for the
    // long-lived ReplaySubject to complete.
    return this.index$.pipe(
      take(1),
      switchMap((mini) => {
        const raw = mini.search(trimmed);
        const hits: SitePageHit[] = raw.slice(0, limit).map((r) => ({
          id: r.id as number,
          title: r['title'],
          category: r['category'],
          url: r['url'],
          body: r['body'] || '',
          excerpt: r['excerpt'],
          date: r['date'],
          score: r.score,
        }));
        return of(hits);
      }),
    );
  }

  private loadIndex(): void {
    this.http.get<SiteSearchIndexItem[]>('/site-search-index.json').subscribe({
      next: (items) => {
        const mini = new MiniSearch<SiteSearchIndexItem>({
          fields: ['title', 'body'],
          storeFields: ['title', 'category', 'url', 'excerpt', 'date', 'body'],
          searchOptions: {
            boost: { title: 3 },
            fuzzy: 0.2,
            prefix: true,
          },
        });
        mini.addAll(items);
        this.index$.next(mini);
      },
      error: () => {
        // Resolve with an empty index so subscribers don't hang on failure.
        this.index$.next(
          new MiniSearch<SiteSearchIndexItem>({ fields: ['title', 'body'] }),
        );
      },
    });
  }
}
