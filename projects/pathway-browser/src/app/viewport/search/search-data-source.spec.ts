import { describe, expect, it } from 'vitest';
import { CollectionViewer, ListRange } from '@angular/cdk/collections';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { Search, SearchDataSource } from './search.component';

const entry = (n: number) => ({ dbId: n, stId: `R-HSA-${n}` }) as unknown as Search.Entry;
const page = (from: number, found: number) => ({
  found,
  facets: [],
  entries: Array.from({ length: Math.min(30, found - from) }, (_, i) => entry(from + i)),
});
const down = () => throwError(() => new Error('500'));

/** A data source over `fetch`, with a viewer that scrolls where it is told. */
function source(fetch: (page: number) => Observable<Search.Result>) {
  const params = new BehaviorSubject<Search.Params | undefined>({ query: 'TP53' });
  const data = new SearchDataSource(params, (n) => fetch(n));
  data.active = true;
  const view = new Subject<ListRange>();
  let rows: (Search.Entry | undefined)[] = [];
  data
    .connect({ viewChange: view } as unknown as CollectionViewer)
    .subscribe((value) => (rows = value));
  return {
    data,
    params,
    scroll: (start: number) => view.next({ start, end: start + 10 }),
    rows: () => rows,
  };
}

// A failed request is not an answer of "nothing": the reader is told, what was
// already found stays, and the page is asked for again.
describe('SearchDataSource', () => {
  it('says so when the search fails, rather than finding nothing', () => {
    const { data } = source(() => down());
    expect(data.failed()).toBe(true);
    expect(data.found()).toBe(0);
  });

  it('keeps what it found when a later page fails, and asks for that page again', () => {
    let fail = true;
    const asked: number[] = [];
    const { data, scroll, rows } = source((n) => {
      asked.push(n);
      return n === 1 && fail ? down() : of(page(n * 30, 45));
    });
    scroll(35);
    expect(data.found()).toBe(45);
    expect(rows()[0]).toEqual(entry(0));
    expect(data.failed()).toBe(true);

    fail = false;
    scroll(36);
    expect(asked).toEqual([0, 1, 1]);
    expect(rows()[40]).toEqual(entry(40));
    expect(data.failed()).toBe(false);
  });

  it('forgets an earlier search when a new one fails', () => {
    let fail = false;
    const { data, params } = source((n) => (fail ? down() : of(page(n * 30, 45))));
    expect(data.found()).toBe(45);
    fail = true;
    params.next({ query: 'BRCA1' });
    expect(data.found()).toBe(0);
    expect(data.failed()).toBe(true);
  });

  it('ignores a failure from a search that has since been replaced', () => {
    const first = new Subject<Search.Result>();
    let calls = 0;
    const { data, params, rows } = source((n) => (calls++ === 0 ? first : of(page(n * 30, 45))));
    params.next({ query: 'BRCA1' });
    expect(data.found()).toBe(45);
    first.error(new Error('502'));
    expect(data.failed()).toBe(false);
    expect(data.found()).toBe(45);
    expect(rows()[0]).toEqual(entry(0));
  });

  it('ignores an answer from a search that has since been cleared', () => {
    const first = new Subject<Search.Result>();
    const { data, params } = source(() => first);
    params.next(undefined);
    first.error(new Error('502'));
    expect(data.failed()).toBe(false);
    expect(data.found()).toBe(0);
  });

  it('stays failed while any page is missing, whatever loads after it', () => {
    let fail = true;
    const { data, scroll } = source((n) => (n === 1 && fail ? down() : of(page(n * 30, 90))));
    // Pages 1 and 2 at once: 1 fails, then 2 arrives.
    scroll(35);
    scroll(55);
    expect(data.failed()).toBe(true);
    fail = false;
    scroll(36);
    expect(data.failed()).toBe(false);
  });

  it('is no longer failed once a search succeeds', () => {
    let fail = true;
    const { data, params } = source((n) => (fail ? down() : of(page(n * 30, 45))));
    expect(data.failed()).toBe(true);
    fail = false;
    params.next({ query: 'BRCA1' });
    expect(data.failed()).toBe(false);
    expect(data.found()).toBe(45);
  });
});
