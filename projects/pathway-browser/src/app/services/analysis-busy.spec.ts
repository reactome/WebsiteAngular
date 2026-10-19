import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { defer, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryWhenBusy } from './analysis.service';

// The analysis gateway answers 503 with Retry-After when its queue is full
// (spec 010 Story 6). An analysis is asked for again once, after the time it
// names, with the reader told it is waiting -- not failed outright.
const busy = (retryAfter?: string) =>
  new HttpErrorResponse({
    status: 503,
    url: '/AnalysisService/identifiers/',
    headers:
      retryAfter === undefined ? new HttpHeaders() : new HttpHeaders({ 'Retry-After': retryAfter }),
  });

/** A source that fails with each of `failures` in turn, then answers. */
function service(failures: unknown[]) {
  let calls = 0;
  const source = defer(() => {
    const failure = failures[calls++];
    return failure === undefined ? of('result') : throwError(() => failure);
  });
  return { source, calls: () => calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('retryWhenBusy', () => {
  it('waits the time a busy service names, says so, and asks once more', async () => {
    const waits: (number | undefined)[] = [];
    const { source, calls } = service([busy('7')]);
    const answer = firstValueFrom(source.pipe(retryWhenBusy<string>((s) => waits.push(s))));
    await vi.advanceTimersByTimeAsync(6_999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBe('result');
    expect(calls()).toBe(2);
    expect(waits.slice(0, 2)).toEqual([7, undefined]);
  });

  it('asks only once more: a second busy answer is the caller’s to report', async () => {
    const { source, calls } = service([busy('1'), busy('1')]);
    const answer = firstValueFrom(source.pipe(retryWhenBusy<string>(() => {}))).catch(
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await answer) as HttpErrorResponse).status).toBe(503);
    expect(calls()).toBe(2);
  });

  it('does not wait on any other failure, or a busy answer without a sensible time', async () => {
    for (const failure of [
      new HttpErrorResponse({ status: 500 }),
      new HttpErrorResponse({ status: 400 }),
      busy(),
      busy('soon'),
      busy('600'),
    ]) {
      const { source, calls } = service([failure]);
      const answer = await firstValueFrom(source.pipe(retryWhenBusy<string>(() => {}))).catch(
        (e: unknown) => e
      );
      expect([answer === failure, calls()]).toEqual([true, 1]);
    }
  });
});
