/**
 * What the service makes of the answers it can get back.
 *
 * The stream's own outcomes are covered in summary-stream.spec.ts. These are
 * the ones that arrive *outside* the stream, as status codes from our own
 * proxy, and each has a different thing to offer the reader: a challenge they
 * can solve, a limit that will pass, or a fault that will not.
 */
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SummaryService } from './summary.service';

// Not a credential, despite the shape: an analysis token is an unauthenticated
// handle of the form base64('YYYYMMDDHHMMSS_counter'), so this one is simply
// `20260915120000_1` spelled out. It names no real result and carries no user
// data -- and every request in this file is answered by a stub anyway.
const TOKEN = 'MjAyNjA5MTUxMjAwMDBfMQ==';

/**
 * A response whose body is a complete SSE stream.
 *
 * Built from a ReadableStream rather than a Blob: jsdom's Blob has no
 * `stream()`, so the obvious spelling throws rather than failing an assertion.
 */
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

beforeEach(() => {
  TestBed.configureTestingModule({});
  service = TestBed.inject(SummaryService);
  // The production profile has no endpoint, so the service would refuse to ask
  // at all. This is the deployment setting, not a behaviour under test.
  Object.defineProperty(service, 'endpoint', { value: '/analysis-summary', writable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('a limit the reader can wait out', () => {
  it('is offered as a rate limit rather than as a failure', async () => {
    // Our proxy has its own budget and says so in a status code; the service
    // says the same thing inside the stream. Both mean "try again shortly", and
    // this one used to fall through to `failed`, which the panel renders as
    // "the summary could not be produced" -- a transient limit described as a
    // fault, with nothing to suggest waiting would help.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    await service.summarise(TOKEN);
    expect(service.state()).toBe('refused');
    expect(service.reason()).toBe('rate_limited');
  });
});

describe('a check the reader can solve', () => {
  it('becomes a challenge, not a state, so the panel shows a widget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sitekey: 'k', verify: '/search-answer/verify' }), {
          status: 401,
        })
      )
    );
    await service.summarise(TOKEN);
    expect(service.challenge()).toEqual({ sitekey: 'k', verify: '/search-answer/verify' });
    expect(service.state()).toBeNull();
  });

  it('is a failure when the 401 carries no way to solve it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await service.summarise(TOKEN);
    expect(service.state()).toBe('failed');
    expect(service.challenge()).toBeNull();
  });
});

describe('a summary that arrives', () => {
  it('keeps the text, the citations and the state the service sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamed(
            'event: start\ndata: {"release": "97", "analysis_type": "OVERREPRESENTATION", "disclosure": "aggregate"}\n\n' +
              'event: token\ndata: {"text": "Your identifiers are enriched in "}\n\n' +
              'event: token\ndata: {"text": "TP53 signalling."}\n\n' +
              'event: citation\ndata: {"st_id": "R-HSA-3700989", "display_name": "Transcriptional Regulation by TP53"}\n\n' +
              'event: done\ndata: {"state": "summarised", "seconds": 4.5}\n\n'
          )
        )
    );
    await service.summarise(TOKEN);
    expect(service.state()).toBe('summarised');
    expect(service.text()).toBe('Your identifiers are enriched in TP53 signalling.');
    expect(service.citations()).toHaveLength(1);
    // The panel puts nothing on screen that it cannot caption honestly.
    expect(service.analysisType()).toBe('OVERREPRESENTATION');
    expect(service.applied()).toBe('aggregate');
    // Not "stopped before it was finished": the summary is complete.
    expect(service.incomplete()).toBe(false);
  });

  it('is remembered, so a second look does not spend the budget again', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        streamed(
          'event: token\ndata: {"text": "A summary."}\n\n' +
            'event: done\ndata: {"state": "summarised"}\n\n'
        )
      );
    vi.stubGlobal('fetch', fetcher);
    await service.summarise(TOKEN);
    await service.summarise(TOKEN);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('asks again when told to refresh, for a chat that has lost its copy', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        streamed(
          'event: token\ndata: {"text": "A summary."}\n\nevent: done\ndata: {"state": "summarised"}\n\n'
        )
      );
    vi.stubGlobal('fetch', fetcher);
    await service.summarise(TOKEN);
    await service.summarise(TOKEN, 'aggregate', { refresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not remember a refusal, which is about this moment and not the result', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await service.summarise(TOKEN);
    await service.summarise(TOKEN);
    // Caching this would mean the reader can never get a summary again in this
    // session: the next click is answered from the cache without a request.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
