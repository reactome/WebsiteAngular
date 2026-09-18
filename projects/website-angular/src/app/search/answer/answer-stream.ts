/**
 * Reading the answer endpoint's event stream.
 *
 * The transport is server-sent events over a POST, and the response is always
 * HTTP 200 -- the outcome is in the `done` event's `state`, never in a status
 * code. The contract that defines it is
 * `specs/010-search-page-answers/contracts/answer_endpoint.md` in
 * reactome_chatbot; the decisions on our side are in
 * `specs/005-search-page-answers/research.md`.
 *
 * Parsing lives here, apart from the service, because it is the part worth
 * testing: a stream arrives in arbitrary chunks, and the interesting cases are
 * a frame split across two reads and a frame that is not what we expect. The
 * service around it does I/O and signals.
 */

/** The outcomes the endpoint reports. Only `answered` renders anything. */
export type AnswerState = 'answered' | 'nothing_found' | 'refused' | 'failed';

/**
 * One source behind an answer.
 *
 * Exactly one of `stId` and `url` is present. A Reactome entity has a stable
 * identifier; a documentation page has neither an identifier nor any honest way
 * to be given one, so it carries its address instead. The chatbot team added
 * the second form after finding that userguide answers had no sources at all --
 * and refused, correctly, to fabricate a stable id to make them fit.
 */
export interface Citation {
  stId?: string;
  url?: string;
  displayName: string;
}

/**
 * Where a citation points.
 *
 * A stable identifier is resolved to a detail page rather than used raw: a
 * reader should never be left on an identifier they have to look up.
 */
export function citationHref(citation: Citation): string {
  return citation.stId ? `/content/detail/${citation.stId}` : (citation.url ?? '');
}

/** What distinguishes one citation from another, for de-duplication. */
export function citationKey(citation: Citation): string {
  return citation.stId ?? citation.url ?? citation.displayName;
}

/**
 * Only http(s) addresses are accepted.
 *
 * The prose is model output and so are these, so a citation is not a promise
 * about its own address. Angular sanitises `[href]`, which makes this the
 * second layer rather than the only one -- but a `javascript:` source has no
 * legitimate reading, and dropping it here means it never reaches a template.
 */
function usableUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const parsed = new URL(value, 'https://reactome.org');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export type AnswerEvent =
  | { kind: 'start'; release: number | null }
  | { kind: 'token'; text: string }
  | { kind: 'citation'; citation: Citation }
  | { kind: 'done'; state: AnswerState };

/**
 * At most this many citations are shown.
 *
 * The server caps at 12 and says the cap binds on ordinary questions, so this
 * is "the most relevant few" and is labelled as such rather than as a complete
 * source list.
 */
export const MAX_CITATIONS = 12;

/**
 * Anything other than these four is treated as `failed`.
 *
 * A state we do not recognise is a contract change, and the safe reading of a
 * contract change is "show nothing" rather than "show this to a reader".
 */
const STATES: readonly string[] = ['answered', 'nothing_found', 'refused', 'failed'];

function asState(value: unknown): AnswerState {
  return typeof value === 'string' && STATES.includes(value) ? (value as AnswerState) : 'failed';
}

/**
 * Turns one complete SSE frame into an event, or null if it is not one we act
 * on.
 *
 * Unknown event names and unparseable data are dropped rather than thrown: a
 * stream that gains a new event type should not break a panel that does not
 * need it.
 */
export function parseFrame(frame: string): AnswerEvent | null {
  let name = '';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    // The space after the colon is optional in SSE and a single leading one is
    // stripped; anything further is data.
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!name || dataLines.length === 0) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (name) {
    case 'start':
      return {
        kind: 'start',
        release: typeof data['release'] === 'number' ? data['release'] : null,
      };
    case 'token':
      return typeof data['text'] === 'string' ? { kind: 'token', text: data['text'] } : null;
    case 'citation': {
      // Either form, and never both: a Reactome entity carries `st_id`, a
      // documentation page carries `url`. A citation with neither points
      // nowhere, so it is dropped rather than rendered as dead text.
      const stId = typeof data['st_id'] === 'string' && data['st_id'] ? data['st_id'] : undefined;
      const url = stId ? undefined : usableUrl(data['url']);
      if (!stId && !url) return null;
      const displayName = data['display_name'];
      return {
        kind: 'citation',
        citation: {
          stId,
          url,
          displayName: typeof displayName === 'string' ? displayName : (stId ?? url ?? ''),
        },
      };
    }
    case 'done':
      return { kind: 'done', state: asState(data['state']) };
    default:
      return null;
  }
}

/**
 * Splits a growing buffer into complete frames, returning the events found and
 * whatever tail is still incomplete.
 *
 * Frames are separated by a blank line, so a trailing fragment with no
 * separator yet has to be kept for the next chunk. Both `\n\n` and `\r\n\r\n`
 * occur in practice.
 */
export function drainFrames(buffer: string): { events: AnswerEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n');
  const parts = normalised.split('\n\n');
  // The last part is either an incomplete frame or the empty string left by a
  // trailing separator. Either way it is not ready.
  const rest = parts.pop() ?? '';
  const events: AnswerEvent[] = [];
  for (const part of parts) {
    const event = parseFrame(part);
    if (event) events.push(event);
  }
  return { events, rest };
}

/**
 * The cache key for a question.
 *
 * Answers are not reproducible -- the same question twice returns different
 * prose and largely different sources, because query expansion is itself a
 * model call. A reader who reloads would otherwise see a different panel, so
 * repeats are served from our cache, and `release` invalidates it.
 *
 * Normalising is deliberately shallow: case, surrounding space, runs of
 * whitespace, and trailing question marks. Anything cleverer would start
 * merging questions a reader means differently.
 */
export function cacheKey(question: string, release: number | null): string {
  const normalised = question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\?+$/, '');
  return `${release ?? 'unknown'}::${normalised}`;
}

/**
 * Whether there is prose to show.
 *
 * Prose is shown as it arrives rather than withheld until `done`, which gets
 * the reader text at about 10s instead of a wait to about 16s. That is safe
 * because of a guarantee in the endpoint's own code, not because it usually
 * works out: `answered` flips true the moment the first non-empty token is
 * emitted, and the terminal state is `answered if answered else nothing_found`.
 * So `nothing_found` after a token is impossible by construction, and `refused`
 * happens before the graph is touched at all -- which is why it lands at 0.0s.
 *
 * An outcome with no prose shows nothing whatsoever. Roughly one question in
 * seven is `nothing_found` in about 4.5s, and treating an ordinary outcome as
 * an error would train readers to distrust a feature that behaved correctly.
 */
export function showsProse(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Removes a trailing "Sources" section the model wrote itself.
 *
 * The prose frequently ends with its own list, and it is the useless copy of
 * the one we already render: the contract strips anchors from the prose, so the
 * model's version is plain text with no links, while the `citation` events give
 * us the same names with resolvable stable identifiers. Leaving both makes the
 * panel noticeably longer and shows the reader two source lists, one of which
 * cannot be clicked.
 *
 * Deliberately conservative. It strips only from the last heading whose text is
 * some form of "sources", "references" or "citations", and only when everything
 * after it is list items -- so a section that continues into real prose is left
 * alone rather than swallowed.
 */
export function stripTrailingSources(text: string): string {
  const headings = [
    ...text.matchAll(/^#{1,6}[ \t]*(sources?|references?|citations?)[ \t]*:?[ \t]*$/gim),
  ];
  const last = headings.at(-1);
  if (!last?.index) return text;

  const after = text.slice(last.index + last[0].length);
  const lines = after.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return text.slice(0, last.index).trimEnd();
  // Every remaining line must look like a list item, or this is prose we have
  // no business removing.
  if (!lines.every((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))) return text;

  return text.slice(0, last.index).trimEnd();
}

/**
 * Whether prose on screen stopped early.
 *
 * The two ways to get tokens and then a non-`answered` state are both faults
 * rather than outcomes: the 120s ceiling, and an exception mid-generation. The
 * chatbot team has never observed either across everything measured, but "never
 * by construction" applies only to `nothing_found` and `refused`, so this is
 * designed for rather than assumed away.
 *
 * What it must *not* do is withdraw the text. The reader has been reading real,
 * retrieved text, and nothing about generation stopping makes what arrived
 * wrong. Taking it back mid-read is the worse failure for a scientific
 * resource, so the panel stays and says it is incomplete.
 */
export function isIncomplete(state: AnswerState | null, text: string): boolean {
  return showsProse(text) && state !== null && state !== 'answered';
}
