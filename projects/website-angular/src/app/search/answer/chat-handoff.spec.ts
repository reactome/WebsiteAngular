import { describe, expect, it, vi } from 'vitest';
import { continueInChat, describeHandoffFailure, type TabOpener } from './chat-handoff';

/** A tab and a window that record what was done to them. */
function fakes(openReturnsTab = true) {
  const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  const win = {
    location: { origin: 'https://beta.reactome.org' },
    open: vi.fn(() => (openReturnsTab ? tab : null)),
  };
  return { tab, win: win as unknown as TabOpener & typeof win };
}

const respond = (...replies: { status: number; body: unknown }[]) => {
  const queue = [...replies];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('more requests than replies');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
};

const search = { kind: 'search', answer_id: 'Ev3z3JDmIIUF4gkKTfrn9VF83H' } as const;
const analysis = {
  kind: 'analysis',
  token: 'MjAyNjA5MTUxMjAwMDBfMQ==',
  disclosure: 'aggregate',
} as const;

describe('continuing in chat', () => {
  it('opens the tab in the click, then sends it to the chat, cut from this page', async () => {
    const { tab, win } = fakes();
    const fetcher = respond({
      status: 200,
      body: { path: '/chat/guest/#handoff=abc', expires_in: 900 },
    });
    const outcome = await continueInChat('/chat-handoff', search, { win, fetcher });
    expect(outcome).toEqual({ ok: true });
    // Opened before the request, which is what keeps it a user gesture.
    expect(win.open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    // The id stays in the fragment, which browsers never send to a server.
    expect(tab.location.href).toBe('https://beta.reactome.org/chat/guest/#handoff=abc');
  });

  it('sends exactly the request it was given', async () => {
    const { win } = fakes();
    const fetcher = respond({ status: 200, body: { path: '/chat/guest/#handoff=abc' } });
    await continueInChat('/chat-handoff', analysis, { win, fetcher });
    const [, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(JSON.parse(init.body as string)).toEqual(analysis);
  });

  it('refreshes once when the chat has lost the summary, then continues', async () => {
    // Every chatbot deploy empties its in-memory store.
    const { tab, win } = fakes();
    const refresh = vi.fn(async () => undefined);
    const fetcher = respond(
      { status: 404, body: { reason: 'no_summary' } },
      { status: 200, body: { path: '/chat/guest/#handoff=def' } }
    );
    expect(await continueInChat('/chat-handoff', analysis, { win, fetcher, refresh })).toEqual({
      ok: true,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(tab.location.href).toContain('#handoff=def');
  });

  it('closes the blank tab and says why when it cannot continue', async () => {
    const { tab, win } = fakes();
    for (const [status, reason, failure] of [
      [404, 'no_answer', 'gone'],
      [403, 'stale_human', 'verify'],
      [401, undefined, 'verify'],
      // Our own caller token refused: a fault here, not a check to pass.
      [403, 'no_caller', 'unavailable'],
      [429, 'rate_limited', 'rate_limited'],
      [503, 'no_release', 'unavailable'],
    ] as const) {
      tab.close.mockClear();
      const fetcher = respond({ status, body: reason ? { reason } : {} });
      expect(await continueInChat('/chat-handoff', search, { win, fetcher })).toEqual({
        ok: false,
        failure,
      });
      expect(tab.close).toHaveBeenCalled();
    }
  });

  it('never sends the tab anywhere but the guest chat on this site', async () => {
    const { tab, win } = fakes();
    for (const path of ['https://evil.example/chat/guest/#handoff=x', '/elsewhere/#handoff=x']) {
      const fetcher = respond({ status: 200, body: { path } });
      expect(await continueInChat('/chat-handoff', search, { win, fetcher })).toEqual({
        ok: false,
        failure: 'unavailable',
      });
      expect(tab.location.href).toBe('about:blank');
    }
  });

  it('asks an analysis reader for the check, and tells a search reader it is not theirs to fix', () => {
    expect(describeHandoffFailure('verify', 'analysis')).toMatch(/check/);
    expect(describeHandoffFailure('verify', 'search')).not.toMatch(/Summarise/);
  });

  it('says so when the browser blocks the tab', async () => {
    const { win } = fakes(false);
    const fetcher = respond({ status: 200, body: { path: '/chat/guest/#handoff=abc' } });
    expect(await continueInChat('/chat-handoff', search, { win, fetcher })).toEqual({
      ok: false,
      failure: 'blocked',
    });
  });

  it('has a sentence for every failure', () => {
    for (const failure of ['gone', 'verify', 'rate_limited', 'blocked', 'unavailable'] as const) {
      expect(describeHandoffFailure(failure, 'search').length).toBeGreaterThan(10);
    }
  });
});
