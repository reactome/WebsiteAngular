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
import {
  cacheKey,
  citationHref,
  drainFrames,
  isIncomplete,
  parseFrame,
  showsProse,
  stripTrailingSources,
  type AnswerEvent,
} from './answer-stream';

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
  it('shows prose while it is still arriving', () => {
    // Progressive, so the reader gets text at ~10s rather than waiting to ~16s.
    expect(showsProse('partial text')).toBe(true);
    expect(isIncomplete(null, 'partial text')).toBe(false);
  });

  it.each(['nothing_found', 'refused', 'failed'] as const)(
    'shows nothing at all for %s with no prose',
    (state) => {
      // About one question in seven is nothing_found, in ~4.5s. An ordinary
      // outcome, so no panel and no error either.
      expect(showsProse('')).toBe(false);
      expect(isIncomplete(state, '')).toBe(false);
    }
  );

  it('shows nothing when answered arrives with only whitespace', () => {
    expect(showsProse('   ')).toBe(false);
  });

  it('keeps prose that stopped early, and marks it incomplete', () => {
    // The two routes to tokens-then-not-answered are the 120s ceiling and an
    // exception mid-generation -- both faults. Withdrawing text a reader is
    // already reading is the worse failure, so it stays and says so.
    expect(showsProse('half an answer')).toBe(true);
    expect(isIncomplete('failed', 'half an answer')).toBe(true);
  });

  it('does not mark a completed answer incomplete', () => {
    expect(isIncomplete('answered', 'a whole answer')).toBe(false);
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

describe('the sources the model writes itself', () => {
  // Taken from a real answer: "What happens in the Golgi during N-glycan
  // maturation?" ended with its own `### Sources` list. The contract strips
  // anchors from the prose, so that copy has no links -- while the citation
  // events give the same names with resolvable stable ids. Rendering both
  // showed two source lists, one unclickable, and made the panel noticeably
  // longer.
  const answer = [
    'The Golgi matures N-glycans through ordered enzymatic steps.',
    '',
    '### Sources',
    '- N-glycan trimming and elongation in the cis-Golgi',
    '- N-glycan antennae elongation in the medial/trans-Golgi',
  ].join('\n');

  it('removes a trailing Sources heading and its list', () => {
    expect(stripTrailingSources(answer)).toBe(
      'The Golgi matures N-glycans through ordered enzymatic steps.'
    );
  });

  it.each(['## References', '#### Citations', '### sources:', '## Source'])(
    'removes %s too',
    (heading) => {
      const text = `Body text.\n\n${heading}\n- One\n- Two`;
      expect(stripTrailingSources(text)).toBe('Body text.');
    }
  );

  it('leaves prose alone when the section is not a list', () => {
    // A heading called "Sources" followed by real prose is content, not a
    // bibliography, and swallowing it would delete part of the answer.
    const text = 'Body.\n\n### Sources\nThese pathways were drawn from the literature.';
    expect(stripTrailingSources(text)).toBe(text);
  });

  it('leaves an answer with no such section untouched', () => {
    expect(stripTrailingSources('Just an answer.')).toBe('Just an answer.');
  });

  it('does not touch a heading of the same name mid-answer', () => {
    // Only a *trailing* section is removed, and only when nothing but list
    // items follows it.
    const text = '### Sources\n- One\n\nThen more explanation follows here.';
    expect(stripTrailingSources(text)).toBe(text);
  });

  it('keeps a numbered list section out too', () => {
    expect(stripTrailingSources('Body.\n\n## Sources\n1. One\n2. Two')).toBe('Body.');
  });
});

describe('citations that are documentation pages rather than entities', () => {
  // The chatbot team added this form after finding userguide answers had no
  // sources at all: a citation needs a stable identifier and a documentation
  // page has none, and they refused to fabricate one to make it fit. Exactly
  // one of `st_id` and `url` is present.
  //
  // Written before their change is deployed, because the old parser *required*
  // `st_id` and returned null otherwise -- so these citations would have been
  // dropped in silence, and userguide answers would have shown no sources with
  // nothing to indicate why.
  const urlFrame =
    'event: citation\ndata: {"url": "https://reactome.org/userguide/pathway-browser", "display_name": "The Pathway Browser"}';

  it('accepts a citation carrying a url', () => {
    expect(parseFrame(urlFrame)).toEqual({
      kind: 'citation',
      citation: {
        stId: undefined,
        url: 'https://reactome.org/userguide/pathway-browser',
        displayName: 'The Pathway Browser',
      },
    });
  });

  it('links a url citation to that url, and a stable id to its detail page', () => {
    // A reader is never left on a bare identifier.
    expect(citationHref({ url: 'https://reactome.org/userguide/x', displayName: 'x' })).toBe(
      'https://reactome.org/userguide/x'
    );
    expect(citationHref({ stId: 'R-HSA-70171', displayName: 'Glycolysis' })).toBe(
      '/content/detail/R-HSA-70171'
    );
  });

  it('prefers the stable id if both somehow arrive', () => {
    const frame =
      'event: citation\ndata: {"st_id": "R-HSA-1", "url": "https://example.org/x", "display_name": "Both"}';
    const event = parseFrame(frame);
    expect(event).toMatchObject({ citation: { stId: 'R-HSA-1', url: undefined } });
  });

  it('drops a citation whose url is not http', () => {
    // These addresses are model output, so a citation is not a promise about
    // its own href. Angular sanitises `[href]` as well; this keeps it from ever
    // reaching a template.
    expect(
      parseFrame('event: citation\ndata: {"url": "javascript:alert(1)", "display_name": "x"}')
    ).toBeNull();
    expect(
      parseFrame('event: citation\ndata: {"url": "data:text/html,x", "display_name": "x"}')
    ).toBeNull();
  });

  it('drops a citation that points nowhere at all', () => {
    expect(parseFrame('event: citation\ndata: {"display_name": "Nowhere"}')).toBeNull();
  });
});
