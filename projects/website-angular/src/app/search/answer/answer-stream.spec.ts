/**
 * Reading the answer endpoint's event stream.
 *
 * These are the cases a live endpoint will not reliably produce on demand: a
 * frame split across two network reads, an event type we do not know, a `state`
 * that is not in the contract, and a stream that stops without a `done`. The
 * endpoint is not deployed yet, so this is also the only thing currently
 * holding the parser honest.
 */
import { describe, expect, it } from 'vitest';
import { cacheKey, drainFrames, parseFrame, shouldRender, type AnswerEvent } from './answer-stream';

const START = 'event: start\ndata: {"release": 97, "answered": true}';
const TOKEN = 'event: token\ndata: {"text": "CDK5, when bound to p25, "}';
const CITATION =
  'event: citation\ndata: {"st_id": "R-HSA-8862803", "display_name": "Deregulated CDK5"}';
const DONE = 'event: done\ndata: {"state": "answered", "seconds": 8.4}';

function feed(chunks: string[]): AnswerEvent[] {
  let buffer = '';
  const events: AnswerEvent[] = [];
  for (const chunk of chunks) {
    buffer += chunk;
    const drained = drainFrames(buffer);
    buffer = drained.rest;
    events.push(...drained.events);
  }
  return events;
}

describe('parsing one frame', () => {
  it('reads the release off the start event', () => {
    expect(parseFrame(START)).toEqual({ kind: 'start', release: 97 });
  });

  it('reads token text', () => {
    expect(parseFrame(TOKEN)).toEqual({ kind: 'token', text: 'CDK5, when bound to p25, ' });
  });

  it('reads a citation and its stable id', () => {
    expect(parseFrame(CITATION)).toEqual({
      kind: 'citation',
      citation: { stId: 'R-HSA-8862803', displayName: 'Deregulated CDK5' },
    });
  });

  it('falls back to the stable id when a citation carries no name', () => {
    const frame = 'event: citation\ndata: {"st_id": "R-HSA-70171"}';
    expect(parseFrame(frame)).toEqual({
      kind: 'citation',
      citation: { stId: 'R-HSA-70171', displayName: 'R-HSA-70171' },
    });
  });

  it('reads the done state', () => {
    expect(parseFrame(DONE)).toEqual({ kind: 'done', state: 'answered' });
  });

  it('treats a state outside the contract as failed, so nothing renders', () => {
    // A new state is a contract change, and the safe reading of one is "show
    // nothing" rather than "show this to a reader".
    const frame = 'event: done\ndata: {"state": "partially_answered"}';
    expect(parseFrame(frame)).toEqual({ kind: 'done', state: 'failed' });
  });

  it('ignores an event type it does not know', () => {
    expect(parseFrame('event: heartbeat\ndata: {}')).toBeNull();
  });

  it('ignores a frame whose data is not JSON', () => {
    expect(parseFrame('event: token\ndata: not json')).toBeNull();
  });

  it('ignores a token event with no text, rather than rendering "undefined"', () => {
    expect(parseFrame('event: token\ndata: {"texts": ["a"]}')).toBeNull();
  });
});

describe('draining a stream that arrives in chunks', () => {
  it('reads a whole stream delivered in one piece', () => {
    const events = feed([[START, TOKEN, CITATION, DONE].join('\n\n') + '\n\n']);
    expect(events.map((e) => e.kind)).toEqual(['start', 'token', 'citation', 'done']);
  });

  it('holds back a frame split across two reads', () => {
    // The network splits wherever it likes. Parsing the first half would drop a
    // token, and a dropped token is a word missing from the middle of a sentence.
    const events = feed([START + '\n\nevent: token\ndata: {"text": "half', ' a token"}\n\n']);
    expect(events).toEqual([
      { kind: 'start', release: 97 },
      { kind: 'token', text: 'half a token' },
    ]);
  });

  it('handles a split in the middle of the frame separator', () => {
    const events = feed([START + '\n', '\n' + TOKEN + '\n\n']);
    expect(events.map((e) => e.kind)).toEqual(['start', 'token']);
  });

  it('accepts CRLF separators', () => {
    const events = feed([`${START}\r\n\r\n${DONE}\r\n\r\n`]);
    expect(events.map((e) => e.kind)).toEqual(['start', 'done']);
  });

  it('leaves an unterminated final frame unparsed', () => {
    // A dropped connection sends no `done`, so the tail must not be mistaken for
    // a complete frame -- the panel stays unrendered rather than showing a
    // half-sentence as if it were finished.
    const { events, rest } = drainFrames(START + '\n\nevent: token\ndata: {"text": "cut off');
    expect(events).toEqual([{ kind: 'start', release: 97 }]);
    expect(rest).toContain('cut off');
  });
});

describe('what the reader sees', () => {
  it('renders only an answered state with text', () => {
    expect(shouldRender('answered', 'something')).toBe(true);
  });

  it.each(['nothing_found', 'refused', 'failed'] as const)('renders nothing for %s', (state) => {
    // About one question in seven is nothing_found, in ~4.5s. It is an ordinary
    // outcome, so there is no panel and no error either.
    expect(shouldRender(state, 'something')).toBe(false);
  });

  it('renders nothing when answered arrives with no prose', () => {
    expect(shouldRender('answered', '   ')).toBe(false);
  });

  it('renders nothing before a done event arrives', () => {
    expect(shouldRender(null, 'partial text')).toBe(false);
  });
});

describe('the cache key', () => {
  it('treats the same question asked differently as the same question', () => {
    expect(cacheKey('  What is CDK5?  ', 97)).toBe(cacheKey('what is cdk5', 97));
  });

  it('collapses runs of whitespace', () => {
    expect(cacheKey('what   is\tCDK5', 97)).toBe(cacheKey('what is CDK5', 97));
  });

  it('separates releases, which is what invalidates the cache', () => {
    expect(cacheKey('what is CDK5', 97)).not.toBe(cacheKey('what is CDK5', 98));
  });

  it('does not merge questions that differ in more than punctuation and case', () => {
    expect(cacheKey('what is CDK5', 97)).not.toBe(cacheKey('what is CDK6', 97));
  });

  it('keeps an unknown release distinct from a known one', () => {
    expect(cacheKey('what is CDK5', null)).not.toBe(cacheKey('what is CDK5', 97));
  });
});
