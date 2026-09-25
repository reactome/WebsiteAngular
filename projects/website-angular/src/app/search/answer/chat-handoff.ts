/**
 * "Continue in chat": open the chat with the reader's summary or answer already
 * in the conversation.
 *
 * The chat runs in its own tab. The tab is opened *inside* the click, before
 * anything is fetched, because a browser only lets a page open a tab on a
 * direct user gesture and an `await` ends the gesture. It is opened blank, then
 * sent to the chat once the handoff exists -- or closed, if it cannot be made.
 * It is not opened `noopener`, because then there is no handle to send it on
 * with; the opener link is cut before it navigates instead.
 */

export type HandoffRequest =
  | { kind: 'analysis'; token: string; disclosure: 'aggregate' | 'identifiers' }
  | { kind: 'search'; answer_id: string };

/** Why a handoff could not be opened, in terms of what the reader can do. */
export type HandoffFailure = 'gone' | 'verify' | 'rate_limited' | 'blocked' | 'unavailable';

export type HandoffOutcome = { ok: true } | { ok: false; failure: HandoffFailure };

/** The parts of `window` this needs, so a test can stand in for it. */
export interface TabOpener {
  open(url: string, target: string): Window | null;
  location: { origin: string };
}

async function mint(endpoint: string, request: HandoffRequest, fetcher: typeof fetch) {
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = (await response.json().catch(() => null)) as {
      path?: unknown;
      reason?: unknown;
    } | null;
    return { status: response.status, path: body?.path, reason: body?.reason };
  } catch {
    return { status: 0, path: undefined, reason: undefined };
  }
}

function failureFor(status: number, reason: unknown): HandoffFailure {
  if (status === 404) return 'gone';
  if (
    status === 401 ||
    reason === 'no_human' ||
    reason === 'stale_human' ||
    reason === 'no_caller'
  ) {
    return 'verify';
  }
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

/**
 * Opens the chat on this summary or answer.
 *
 * `refresh` is asked for once when the chat no longer holds what we asked to
 * continue: its store is in memory, so every chatbot deploy empties it, and a
 * fresh summary puts it back. Answers cannot be refreshed that way -- a new
 * answer is a different answer -- so the search panel passes none.
 */
export async function continueInChat(
  endpoint: string,
  request: HandoffRequest,
  {
    win = window,
    fetcher = fetch,
    refresh,
  }: { win?: TabOpener; fetcher?: typeof fetch; refresh?: () => Promise<void> } = {}
): Promise<HandoffOutcome> {
  const tab = win.open('about:blank', '_blank');

  let result = await mint(endpoint, request, fetcher);
  if (result.status === 404 && refresh) {
    await refresh();
    result = await mint(endpoint, request, fetcher);
  }

  if (result.status === 200 && typeof result.path === 'string') {
    const url = new URL(result.path, win.location.origin).href;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
      return { ok: true };
    }
    // Blocked in the click after all; one more try now, which some browsers allow.
    return win.open(url, '_blank') ? { ok: true } : { ok: false, failure: 'blocked' };
  }

  tab?.close();
  return { ok: false, failure: failureFor(result.status, result.reason) };
}

/** What to tell the reader, one sentence each. */
export function describeHandoffFailure(
  failure: HandoffFailure,
  kind: HandoffRequest['kind']
): string {
  switch (failure) {
    case 'gone':
      return kind === 'analysis'
        ? 'The chat could not find this summary. Summarise the result again, then continue.'
        : 'The chat could not find this answer. Ask the question again, then continue.';
    case 'verify':
      return 'Summarise the result again to show you are still here, then continue.';
    case 'rate_limited':
      return 'Too many chats were started just now. Try again in a minute.';
    case 'blocked':
      return 'Your browser blocked the new tab. Allow pop-ups for this site and try again.';
    case 'unavailable':
      return 'The chat is not available right now. Try again shortly.';
  }
}
