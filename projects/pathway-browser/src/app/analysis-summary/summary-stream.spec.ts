import { describe, expect, it } from 'vitest';
import {
  drainFrames,
  isDowngraded,
  isIncomplete,
  parseFrame,
  showsProse,
  type Disclosure,
} from './summary-stream';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}`;

describe('the start event', () => {
  it('carries the tier the summary was actually built from', () => {
    // Not the tier requested. Ask for `identifiers`, have the lookup fail, and
    // the aggregate summary comes back saying `aggregate` -- the reader chose
    // to disclose and was handed the other summary.
    const event = parseFrame(
      frame('start', {
        release: 97,
        analysis_type: 'OVERREPRESENTATION',
        cached: false,
        disclosure: 'aggregate',
      })
    );
    expect(event).toEqual({
      kind: 'start',
      start: {
        release: 97,
        analysisType: 'OVERREPRESENTATION',
        cached: false,
        disclosure: 'aggregate',
      },
    });
  });

  it('refuses to name an analysis type it has no copy for', () => {
    // The three ReactomeGSA types terminate as `unsupported` and never reach a
    // model, so a type outside the three is a contract change. Null rather than
    // passed through, because every use of this field decides what the panel is
    // allowed to claim.
    const event = parseFrame(frame('start', { analysis_type: 'GSA_REGULATION' }));
    expect(event).toMatchObject({ start: { analysisType: null } });
  });

  it('takes the release as an int, which is what the field is becoming', () => {
    // The service is changing this from a string to an int to match
    // `/api/answer`, which always sent one. Both spellings are accepted so that
    // neither side of that change breaks the panel.
    expect(parseFrame(frame('start', { release: 97 }))).toMatchObject({
      start: { release: 97 },
    });
  });

  it('still takes the string form the field had before that', () => {
    // `"97"`, not `97`. Requiring a number here silently nulled every release,
    // and the field is what tells one release's cached summary from another's.
    expect(parseFrame(frame('start', { release: '97' }))).toMatchObject({
      start: { release: 97 },
    });
  });

  it('has no release rather than a wrong one when the field makes no sense', () => {
    expect(parseFrame(frame('start', { release: 'unreleased' }))).toMatchObject({
      start: { release: null },
    });
  });

  it('never turns an absent release into release 0', () => {
    // `Number(null)`, `Number('')` and `Number(false)` are all 0, and 0 is a
    // number that caches and compares perfectly happily while naming no release
    // that has ever existed.
    for (const release of [null, '', '   ', false, []]) {
      expect(parseFrame(frame('start', { release }))).toMatchObject({ start: { release: null } });
    }
    expect(parseFrame(frame('start', {}))).toMatchObject({ start: { release: null } });
  });

  it('treats a missing cached flag as not cached', () => {
    expect(parseFrame(frame('start', {}))).toMatchObject({ start: { cached: false } });
  });
});

describe('the done event', () => {
  it('recognises the state a successful summary actually ends on', () => {
    // `summarised`, not `answered`. This was written from the contract's prose,
    // which borrows the search answer's vocabulary, and the wire says otherwise.
    //
    // Nothing caught it, because the cases below assert every *failure* state
    // and never the success one -- so the whole suite passed against a parser
    // that turned every good summary into `failed`. On beta that rendered a
    // complete, correct summary under "this summary stopped before it was
    // finished" and "the summary could not be produced". Read off a real
    // stream in the end, which is the only place a vocabulary is settled.
    expect(parseFrame(frame('done', { state: 'summarised', seconds: 4.5 }))).toMatchObject({
      state: 'summarised',
    });
    expect(isIncomplete('summarised', 'a complete summary')).toBe(false);
  });

  it('keeps gone and not_found apart', () => {
    // The whole reason they are separate: `gone` means the result predates this
    // release and can be re-run, which is an action. `not_found` is a dead end.
    expect(parseFrame(frame('done', { state: 'gone' }))).toMatchObject({ state: 'gone' });
    expect(parseFrame(frame('done', { state: 'not_found' }))).toMatchObject({
      state: 'not_found',
    });
  });

  it('carries the refusal reason', () => {
    expect(parseFrame(frame('done', { state: 'refused', reason: 'rate_limited' }))).toMatchObject({
      state: 'refused',
      reason: 'rate_limited',
    });
  });

  it('marks a reason it does not know as unknown rather than dropping it', () => {
    // A new reason is a contract change. Knowing that a reason was given, and
    // that we do not recognise it, is worth more than pretending none came --
    // but inventing copy for it would be worse than saying less.
    expect(parseFrame(frame('done', { state: 'refused', reason: 'quota_exceeded' }))).toMatchObject(
      { reason: 'unknown' }
    );
  });

  it('treats an unrecognised state as failed, which shows nothing', () => {
    expect(parseFrame(frame('done', { state: 'something_new' }))).toMatchObject({
      state: 'failed',
    });
  });
});

describe('citations', () => {
  it('keeps one that can be linked', () => {
    expect(
      parseFrame(frame('citation', { st_id: 'R-HSA-109581', display_name: 'Apoptosis' }))
    ).toEqual({
      kind: 'citation',
      citation: { stId: 'R-HSA-109581', displayName: 'Apoptosis' },
    });
  });

  it('drops one with no stable id, rather than linking to undefined', () => {
    // The panel builds `/content/detail/<stId>` from this. A citation arriving
    // without one produced `/content/detail/undefined` -- a dead link under a
    // real name, which is worse than the name not appearing. Unlike the search
    // answer there is no url form to fall back to.
    expect(parseFrame(frame('citation', { display_name: 'Apoptosis' }))).toBeNull();
  });

  it('drops one with no name, which would render as an empty link', () => {
    expect(parseFrame(frame('citation', { st_id: 'R-HSA-109581' }))).toBeNull();
  });
});

describe('frames that are not ours', () => {
  it('drops an event name it does not act on', () => {
    expect(parseFrame(frame('heartbeat', {}))).toBeNull();
  });

  it('drops a frame whose data will not parse, rather than throwing', () => {
    expect(parseFrame('event: done\ndata: {not json')).toBeNull();
  });

  it('drops an empty token, which would render as nothing anyway', () => {
    expect(parseFrame(frame('token', { text: '' }))).toBeNull();
  });
});

describe('a stream arriving in arbitrary chunks', () => {
  it('holds back a frame split across two reads', () => {
    const whole = `${frame('token', { text: 'Pathways ' })}\n\n${frame('token', { text: 'of interest' })}\n\n`;
    const cut = whole.indexOf('of interest') - 12;

    const first = drainFrames(whole.slice(0, cut));
    expect(first.events).toHaveLength(1);
    expect(first.rest).not.toBe('');

    const second = drainFrames(first.rest + whole.slice(cut));
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ kind: 'token', text: 'of interest' });
  });

  it('reads frames separated by CRLF as well as LF', () => {
    const { events } = drainFrames(`event: done\r\ndata: {"state":"gone"}\r\n\r\n`);
    expect(events[0]).toMatchObject({ kind: 'done', state: 'gone' });
  });
});

describe('whether a disclosure was downgraded', () => {
  it('says so when the applied tier differs from the requested one', () => {
    expect(isDowngraded('identifiers', 'aggregate')).toBe(true);
  });

  it('does NOT call it a downgrade when there was nothing to disclose', () => {
    // The case that matters. A result where every identifier matched reports
    // `identifiers`, because the tier was honoured and there was nothing to
    // retrieve. Telling that reader their disclosure failed, at the moment
    // their data was perfectly clean, is the worst possible time to say it.
    expect(isDowngraded('identifiers', 'identifiers')).toBe(false);
  });

  it('says nothing when the service did not report a tier', () => {
    expect(isDowngraded('identifiers', null)).toBe(false);
  });

  it('is never a downgrade when aggregate was what was asked for', () => {
    for (const applied of ['aggregate', 'identifiers', null] as (Disclosure | null)[]) {
      if (applied === 'identifiers') continue;
      expect(isDowngraded('aggregate', applied)).toBe(false);
    }
  });
});

describe('prose already on screen', () => {
  it('is not withdrawn when generation stops early', () => {
    // What arrived was real text, and nothing about generation stopping makes
    // it wrong. Taking it back mid-read is the worse failure.
    expect(isIncomplete('failed', 'Pathways of interest include')).toBe(true);
    expect(showsProse('Pathways of interest include')).toBe(true);
  });

  it('is not called incomplete before a terminal state arrives', () => {
    expect(isIncomplete(null, 'partial text')).toBe(false);
  });

  it('shows nothing at all for an outcome that produced no prose', () => {
    expect(showsProse('   ')).toBe(false);
    expect(isIncomplete('gone', '')).toBe(false);
  });
});
