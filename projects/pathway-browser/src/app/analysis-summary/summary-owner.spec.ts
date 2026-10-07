/**
 * A summary is shown only beside the result it was written about.
 *
 * The service is a root singleton; the panel is not. Opening the analysis form
 * hides the details area, which destroys the Results tab and the panel in it,
 * and the next result gets a brand-new panel. So the check has to be made
 * against what the *service* holds -- a panel cannot remember what it saw
 * before it existed.
 */
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSummaryForOtherResults } from './summary-owner';
import { SummaryService } from './summary.service';

// Unauthenticated handles, spelled out: base64('20260915120000_1') and _2.
const FIRST = 'MjAyNjA5MTUxMjAwMDBfMQ==';
const SECOND = 'MjAyNjA5MTUxMjAwMDBfMg==';

function streamed(frames: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

let service: SummaryService;
let injector: Injector;

/** Mounts a panel's worth of the check, the way a new panel instance would. */
function mountPanel(token: () => string) {
  return runInInjectionContext(injector, () => clearSummaryForOtherResults(service, token));
}

beforeEach(async () => {
  TestBed.configureTestingModule({});
  service = TestBed.inject(SummaryService);
  injector = TestBed.inject(Injector);
  Object.defineProperty(service, 'endpoint', { value: '/analysis-summary', writable: true });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        streamed(
          'event: token\ndata: {"text": "The first result is enriched in TP53 signalling."}\n\n' +
            'event: done\ndata: {"state": "summarised"}\n\n'
        )
      )
  );
  await service.summarise(FIRST);
  expect(service.visible()).toBe(true);
});

afterEach(() => vi.unstubAllGlobals());

describe('a summary and the result it describes', () => {
  it('is cleared when a new panel opens on a different result', () => {
    // The reader's path: summarise, open the form (the panel is destroyed), run
    // another analysis, and a fresh panel is created for the new token.
    const first = mountPanel(() => FIRST);
    TestBed.tick();
    first.destroy();

    mountPanel(() => SECOND);
    TestBed.tick();

    expect(service.text()).toBe('');
    expect(service.visible()).toBe(false);
  });

  it('is cleared when the same panel moves to a different result', () => {
    const token = signal(FIRST);
    mountPanel(token);
    TestBed.tick();
    token.set(SECOND);
    TestBed.tick();
    expect(service.visible()).toBe(false);
  });

  it('survives a new panel on the same result', () => {
    // Closing and reopening the details area must not throw a summary away.
    mountPanel(() => FIRST).destroy();
    mountPanel(() => FIRST);
    TestBed.tick();
    expect(service.visible()).toBe(true);
  });
});
