/**
 * The answer service: caching, cancellation, and what survives a broken stream.
 *
 * This is the layer worth testing and the one that had no tests. Every defect
 * found reviewing this feature lived here or in the component's use of it --
 * a root-scoped service that never cancelled, a cache lookup that returned
 * before the asking flag was set, an outcome cached that should not have been --
 * while the 26 parser tests passed throughout, because the parser was never the
 * broken part.
 *
 * `fetch` is stubbed rather than mocked at the HttpClient level, because the
 * service deliberately uses `fetch` to read the body as it arrives.
 */
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The profile is read once, at module load, from `window.__APP_ENV`. It has to
// be set before the service module is imported, hence the dynamic import.
(window as Window & { __APP_ENV?: string }).__APP_ENV = 'development';
const { AnswerService } = await import('./answer.service');

const START = 'event: start\ndata: {"release": 97, "answered": true}\n\n';
const DONE_OK = 'event: done\ndata: {"state": "answered", "seconds": 8.4}\n\n';
const token = (text: string) => `event: token\ndata: ${JSON.stringify({ text })}\n\n`;
const citation = (stId: string, name: string) =>
  `event: citation\ndata: ${JSON.stringify({ st_id: stId, display_name: name })}\n\n`;

/** A Response whose body yields the given chunks, one read at a time. */
function streaming(chunks: string[], init: { ok?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: init.ok ?? true,
    status: init.ok === false ? 502 : 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

/** A Response that never finishes, so the request stays in flight. */
function hanging(): Response {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: () => new Promise<never>(() => {}) }) },
  } as unknown as Response;
}

/** Lets pending microtasks and timers run, so `fetch` has been called. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let fetchMock: ReturnType<typeof vi.fn>;

function serve(...responses: Response[]) {
  fetchMock = vi.fn(async () => responses.shift() ?? streaming([START, DONE_OK]));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function service() {
  TestBed.configureTestingModule({ providers: [AnswerService] });
  return TestBed.inject(AnswerService);
}

beforeEach(() => TestBed.resetTestingModule());
afterEach(() => vi.restoreAllMocks());

describe('asking a question', () => {
  it('is offered by a profile that carries an endpoint', () => {
    serve();
    expect(service().available).toBe(true);
  });

  it('accumulates tokens across chunk boundaries into one answer', async () => {
    serve(streaming([START, token('CDK5 bound to p25 '), token('phosphorylates tau.'), DONE_OK]));
    const answers = service();

    await answers.ask('what is CDK5');

    expect(answers.text()).toBe('CDK5 bound to p25 phosphorylates tau.');
    expect(answers.state()).toBe('answered');
    expect(answers.visible()).toBe(true);
    expect(answers.incomplete()).toBe(false);
  });

  it('de-duplicates citations by stable id', async () => {
    serve(
      streaming([
        START,
        token('text'),
        citation('R-HSA-1', 'One'),
        citation('R-HSA-1', 'One again'),
        citation('R-HSA-2', 'Two'),
        DONE_OK,
      ])
    );
    const answers = service();

    await answers.ask('q');

    expect(answers.citations().map((c) => c.stId)).toEqual(['R-HSA-1', 'R-HSA-2']);
  });

  it('sends no question at all when the box is empty', async () => {
    serve();
    await service().ask('   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what a broken stream leaves behind', () => {
  it('keeps the prose and marks it incomplete when the stream stops early', async () => {
    // A dropped connection sends no `done`. The text stays: the reader has been
    // reading real retrieved prose, and generation stopping does not make what
    // arrived wrong.
    serve(streaming([START, token('half an answer')]));
    const answers = service();

    await answers.ask('q');

    expect(answers.text()).toBe('half an answer');
    expect(answers.state()).toBe('failed');
    expect(answers.visible()).toBe(true);
    expect(answers.incomplete()).toBe(true);
  });

  it('shows nothing when a non-200 comes back, since that is not an outcome', async () => {
    // The endpoint answers 200 for every real outcome, so a 502 is the proxy or
    // the network.
    serve(streaming([], { ok: false }));
    const answers = service();

    await answers.ask('q');

    expect(answers.state()).toBe('failed');
    expect(answers.visible()).toBe(false);
  });
});

describe('the cache', () => {
  it('serves a repeat question without asking again', async () => {
    serve(streaming([START, token('an answer'), DONE_OK]));
    const answers = service();

    await answers.ask('what is CDK5');
    await answers.ask('  What is CDK5?  ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answers.text()).toBe('an answer');
  });

  it('serves a settled non-answer without asking again', async () => {
    // `nothing_found` is a property of the question, so a second click must not
    // cost a second model call to be told the same nothing.
    serve(streaming([START, 'event: done\ndata: {"state": "nothing_found"}\n\n']));
    const answers = service();

    await answers.ask('how do I bake bread');
    await answers.ask('how do I bake bread');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answers.state()).toBe('nothing_found');
    expect(answers.visible()).toBe(false);
  });

  it('really re-asks after a failure, rather than replaying it', async () => {
    // The point of not caching `failed`: a reader looking at a truncated answer
    // needs "ask again" to mean it. This is the one that would have shipped
    // wrong -- caching every terminal state made retrying a no-op.
    serve(
      streaming([START, token('half an answer')]),
      streaming([START, token('a whole answer'), DONE_OK])
    );
    const answers = service();

    await answers.ask('q');
    expect(answers.incomplete()).toBe(true);

    await answers.ask('q');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(answers.text()).toBe('a whole answer');
    expect(answers.incomplete()).toBe(false);
  });

  it('separates two different questions', async () => {
    serve(
      streaming([START, token('first'), DONE_OK]),
      streaming([START, token('second'), DONE_OK])
    );
    const answers = service();

    await answers.ask('question one');
    await answers.ask('question two');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(answers.text()).toBe('second');
  });
});

describe('cancellation', () => {
  it('aborts a request still in flight when the injector is destroyed', async () => {
    // The panel unmounts as soon as the reader types into the search box. A
    // root-scoped service kept streaming through that, leaving a model call
    // running for up to 130s that nobody was waiting for and nothing reported.
    //
    // The stream must not have finished: a completed request has nothing to
    // abort, and asserting otherwise tests nothing. My first version of this
    // awaited `ask` and failed for that reason.
    serve(hanging());
    const answers = service();
    void answers.ask('q');
    await flush();

    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted, 'still streaming').toBe(false);
    expect(answers.asking()).toBe(true);

    TestBed.resetTestingModule();

    expect(signal.aborted).toBe(true);
  });

  it('abandons an unfinished question when a new one is asked', async () => {
    serve(hanging(), streaming([START, token('second'), DONE_OK]));
    const answers = service();

    void answers.ask('question one');
    await flush();
    const first = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;

    await answers.ask('question two');

    expect(first.aborted).toBe(true);
    expect(answers.text()).toBe('second');
  });

  it('sends no key material to the endpoint', async () => {
    // The browser has no signing key and must never be given one: the proxy
    // mints the caller token. This pins the request body to the question alone.
    serve();
    const answers = service();

    await answers.ask('what is CDK5');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ question: 'what is CDK5' });
  });
});
