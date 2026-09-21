/**
 * Reading the analysis summary endpoint's event stream.
 *
 * The same transport as the search answer — server-sent events over a POST,
 * always HTTP 200, the outcome in the `done` event rather than a status code —
 * so the citation types and the frame splitting are shared with
 * `search/answer/answer-stream.ts` rather than restated. What differs is the
 * `start` event, which carries what the summary was built from, and the set of
 * terminal states, which is larger and more interesting.
 *
 * The contract is `specs/011-summarise-analysis-results/contracts/summary_endpoint.md`
 * in reactome_chatbot.
 */
import {
  type Citation,
  splitFrames,
} from '../../../../website-angular/src/app/search/answer/answer-stream';

export { type Citation } from '../../../../website-angular/src/app/search/answer/answer-stream';

/**
 * The outcomes the endpoint reports.
 *
 * `gone` is the one that is not a dead end. The Analysis Service deletes
 * results on a release, so it means "that analysis predates the current
 * release — run it again", which is an action the reader can take. `not_found`
 * is a dead end. Collapsing the two throws away the only useful thing the
 * service said, which is why they are separate here and separate in the panel.
 */
export type SummaryState = 'answered' | 'gone' | 'not_found' | 'unsupported' | 'refused' | 'failed';

/**
 * Why a summary was refused.
 *
 * `rate_limited` exists because the service used to answer `no_caller` when a
 * caller was merely asking too often — which a panel renders as "not verified"
 * to somebody who is verified. Anything unrecognised is treated as a plain
 * refusal: a new reason is a contract change, and inventing copy for one we do
 * not know is worse than saying less.
 */
export type RefusalReason =
  'no_caller' | 'no_human' | 'stale_human' | 'rate_limited' | 'unsupported_tier' | 'unknown';

/** How much the summary was allowed to say about unmatched identifiers. */
export type Disclosure = 'aggregate' | 'identifiers';

/**
 * The analysis types that can be summarised, and what each summary may claim.
 *
 * This is a copy constraint rather than a styling one. An over-representation
 * result carries no direction, magnitude or regulation, and the summary is
 * forbidden from saying up, down, increased or activated — so a panel headed
 * "what changed" would promise something the text cannot deliver, and a reader
 * would supply the missing meaning themselves and read enrichment as
 * up-regulation.
 *
 * The three ReactomeGSA types terminate as `unsupported` and never reach a
 * model, so they are absent here by design.
 */
export type AnalysisType = 'OVERREPRESENTATION' | 'EXPRESSION' | 'SPECIES_COMPARISON';

interface SummaryStart {
  release: number | null;
  /** Null when the service names a type we have no copy for. */
  analysisType: AnalysisType | null;
  /**
   * Whether this text was reused. The store is in process, so a summary
   * survives a reload and not a deploy — `false` on something seen yesterday is
   * expected rather than a fault, which is why nothing is promised about
   * freshness from it.
   */
  cached: boolean;
  /**
   * The tier the summary was **actually built from**, which is not always the
   * one asked for: request `identifiers`, have the lookup fail, and the
   * aggregate summary comes back saying `aggregate`. Without comparing the two,
   * a reader who chose to disclose is handed the other summary with nothing
   * saying so.
   */
  disclosure: Disclosure | null;
}

export type SummaryEvent =
  | { kind: 'start'; start: SummaryStart }
  | { kind: 'token'; text: string }
  | { kind: 'citation'; citation: Citation }
  | { kind: 'done'; state: SummaryState; reason: RefusalReason | null };

const STATES: readonly string[] = [
  'answered',
  'gone',
  'not_found',
  'unsupported',
  'refused',
  'failed',
];

const REASONS: readonly string[] = [
  'no_caller',
  'no_human',
  'stale_human',
  'rate_limited',
  'unsupported_tier',
];

const TYPES: readonly string[] = ['OVERREPRESENTATION', 'EXPRESSION', 'SPECIES_COMPARISON'];

function asState(value: unknown): SummaryState {
  return typeof value === 'string' && STATES.includes(value) ? (value as SummaryState) : 'failed';
}

function asReason(value: unknown): RefusalReason | null {
  if (typeof value !== 'string') return null;
  return REASONS.includes(value) ? (value as RefusalReason) : 'unknown';
}

/** Turns one complete SSE frame into an event, or null if it is not one we act on. */
export function parseFrame(frame: string): SummaryEvent | null {
  let name = '';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!name) return null;

  let data: Record<string, unknown> = {};
  if (dataLines.length) {
    try {
      const parsed: unknown = JSON.parse(dataLines.join('\n'));
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch {
      // A frame we cannot read is dropped rather than thrown: a stream that
      // gains a field should not break a panel that does not need it.
      return null;
    }
  }

  switch (name) {
    case 'start':
      return {
        kind: 'start',
        start: {
          release: typeof data['release'] === 'number' ? data['release'] : null,
          analysisType:
            typeof data['analysis_type'] === 'string' && TYPES.includes(data['analysis_type'])
              ? (data['analysis_type'] as AnalysisType)
              : null,
          cached: data['cached'] === true,
          disclosure:
            data['disclosure'] === 'aggregate' || data['disclosure'] === 'identifiers'
              ? data['disclosure']
              : null,
        },
      };
    case 'token': {
      const text = typeof data['text'] === 'string' ? data['text'] : '';
      return text ? { kind: 'token', text } : null;
    }
    case 'citation': {
      const displayName = typeof data['display_name'] === 'string' ? data['display_name'] : '';
      const stId = typeof data['st_id'] === 'string' ? data['st_id'] : undefined;
      return displayName ? { kind: 'citation', citation: { stId, displayName } } : null;
    }
    case 'done':
      return { kind: 'done', state: asState(data['state']), reason: asReason(data['reason']) };
    default:
      return null;
  }
}

/**
 * Splits a growing buffer into complete frames.
 *
 * The splitting itself is the answer stream's — a frame boundary is a frame
 * boundary, and the chunk-split cases it was written for are the ones worth not
 * reimplementing. Only the frames' meaning differs, so only `parseFrame` does.
 */
export function drainFrames(buffer: string): { events: SummaryEvent[]; rest: string } {
  const { frames, rest } = splitFrames(buffer);
  const events: SummaryEvent[] = [];
  for (const frame of frames) {
    const event = parseFrame(frame);
    if (event) events.push(event);
  }
  return { events, rest };
}

/**
 * Whether the reader asked to disclose their identifiers and did not get it.
 *
 * **Nothing to disclose is not a failed disclosure.** A result where every
 * identifier matched reports `identifiers`, because the tier was honoured and
 * there was simply nothing to retrieve. Only a genuine difference between
 * requested and applied counts — otherwise the panel tells somebody their
 * disclosure failed at the moment their data was perfectly clean.
 */
export function isDowngraded(requested: Disclosure, applied: Disclosure | null): boolean {
  return applied !== null && applied !== requested;
}

/** Whether there is prose to show. */
export function showsProse(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Whether prose on screen stopped early.
 *
 * The same rule as the answer panel, and for the same reason: what arrived was
 * real, and nothing about generation stopping makes it wrong. The panel stays
 * and says it is incomplete rather than withdrawing text a reader is reading.
 */
export function isIncomplete(state: SummaryState | null, text: string): boolean {
  return showsProse(text) && state !== null && state !== 'answered';
}
