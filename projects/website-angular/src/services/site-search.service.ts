import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, of, switchMap, take } from 'rxjs';
import MiniSearch from 'minisearch';
import { SiteSearchIndexItem } from '../types/site-search';

export interface SitePageHit extends SiteSearchIndexItem {
  score: number;
}

/** The pages' index, and each page's item by its identifier. */
interface SiteIndex {
  mini: MiniSearch<SiteSearchIndexItem>;
  items: ReadonlyMap<number, SiteSearchIndexItem>;
}

// Loads the static /site-search-index.json once, lazily builds a MiniSearch
// index over the CMS pages, and exposes a single search() method. Used by the
// unified search page to merge page hits into the Solr results as a "Pages"
// group alongside Protein / Pathway / Complex / etc.
@Injectable({ providedIn: 'root' })
export class SiteSearchService {
  private http = inject(HttpClient);

  private index$ = new ReplaySubject<SiteIndex>(1);
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
      switchMap(({ mini, items }) => {
        const raw = mini.search(trimmed);
        // each hit is its page's item, found by the identifier MiniSearch gives back
        const hits: SitePageHit[] = raw.slice(0, limit).flatMap((r) => {
          const id: unknown = r.id;
          const item = typeof id === 'number' ? items.get(id) : undefined;
          return item ? [{ ...item, body: item.body || '', score: r.score }] : [];
        });
        return of(hits);
      })
    );
  }

  private loadIndex(): void {
    // Rebuilt under the same name with every build: the browser checks back
    // rather than keeping a copy (see ContentService).
    this.http
      .get<SiteSearchIndexItem[]>('/site-search-index.json', { cache: 'no-cache' })
      .subscribe({
        next: (items) => {
          const mini = new MiniSearch<SiteSearchIndexItem>({
            fields: ['title', 'body'],
            storeFields: ['title', 'category', 'url', 'excerpt', 'date', 'body'],
            searchOptions: {
              boost: { title: 3 },
              fuzzy: 0.2,
              prefix: true,
              // Require every term to match. MiniSearch defaults to OR, which
              // made any multi-word query return everything containing its most
              // common word -- "xyzzy_no_match_99999" tokenises to
              // xyzzy/no/match/99999 and matched 162 pages on "no" and "match"
              // alone, so the "No results found" state was unreachable. The
              // production site reports no results for that query, and AND both
              // restores that and sharply improves relevance for real queries
              // (e.g. "contact us" and "data model" now rank their own pages
              // first). Single-term queries are unaffected.
              combineWith: 'AND',
            },
          });
          mini.addAll(items);
          this.index$.next({ mini, items: new Map(items.map((item) => [item.id, item])) });
        },
        error: (error: unknown) => {
          // Fail the searches waiting on it, rather than answer them from an
          // empty index -- which read as "no pages match" -- and let the next
          // search load it again.
          const failed = this.index$;
          this.index$ = new ReplaySubject<SiteIndex>(1);
          this.loaded = false;
          failed.error(error);
        },
      });
  }
}
