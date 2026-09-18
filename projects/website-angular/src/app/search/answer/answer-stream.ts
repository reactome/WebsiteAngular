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

export interface Citation {
  stId: string;
  displayName: string;
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
      const stId = data['st_id'];
      if (typeof stId !== 'string' || !stId) return null;
      const displayName = data['display_name'];
      return {
        kind: 'citation',
        citation: { stId, displayName: typeof displayName === 'string' ? displayName : stId },
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
 * Whether a state should put anything on screen.
 *
 * The contract's whole design is that the panel is safe to ignore, and roughly
 * one question in seven returns `nothing_found` in about 4.5 seconds. Treating
 * that as an error would train readers to distrust a feature that behaved
 * correctly.
 */
export function shouldRender(state: AnswerState | null, text: string): boolean {
  return state === 'answered' && text.trim().length > 0;
}
