/**
 * The in-browser reader for a reader's own interactions.
 *
 * Checked against what the service does with the same input, measured on beta's
 * ContentService on 2026-09-15, so that a file works the same whether it is
 * parsed here or uploaded:
 *
 *   #ID_A\tID_B / P49736\tQ99741          -> accepted, no warning
 *   P49736\tQ99741 (no header)            -> accepted, "Missing header. Using a default one."
 *   #ID_A\tID_B\tSCORE                    -> refused
 *   "this is not tabular"                 -> refused, "Could not Parse your file"
 *   a two-line file                       -> 4 interactors, 2 interactions
 */
import { describe, expect, it } from 'vitest';
import { parseCustomInteractions } from './custom-interactor-parse';

const accessionsIn = (text: string) =>
  parseCustomInteractions(text, 'mine')
    .interactors.entities.map((entity) => entity.acc)
    .sort();

describe('reading a pasted list of interactions', () => {
  it('accepts the format the service accepts', () => {
    const parsed = parseCustomInteractions('#ID_A\tID_B\nP49736\tQ99741\n', 'mine');
    expect(parsed.error).toBeUndefined();
    expect(parsed.warnings, 'a well-formed file says nothing').toEqual([]);
  });

  it('reaches the same count the service reported for a two-line file', () => {
    // The service answered {"interactors":4,"interactions":2}. Four accessions,
    // because each pair is held from both ends.
    const parsed = parseCustomInteractions('P49736\tQ99741\nP25205\tP33993\n', 'mine');
    expect(parsed.interactors.entities.length).toBe(4);
  });

  it('holds a pair from both ends, so either partner finds it', () => {
    // Which of the two the diagram happens to draw is not the reader's problem.
    expect(accessionsIn('#ID_A\tID_B\nP49736\tQ99741\n')).toEqual(['P49736', 'Q99741']);
  });

  it('says so when there is no header, because a pair is lost without one', () => {
    const parsed = parseCustomInteractions('P49736\tQ99741\n', 'mine');
    expect(parsed.error).toBeUndefined();
    expect(parsed.warnings.join(' ')).toMatch(/header/i);
    // Unlike the service, the line is kept rather than eaten -- the warning is
    // there to explain a difference, not to excuse losing data.
    expect(parsed.interactors.entities.length).toBe(2);
  });

  it('refuses a third column, as the service does', () => {
    const parsed = parseCustomInteractions('#ID_A\tID_B\tSCORE\nP49736\tQ99741\t0.9\n', 'mine');
    expect(parsed.error).toMatch(/two columns/i);
    expect(parsed.interactors.entities).toEqual([]);
  });

  it('refuses something that is not a table at all', () => {
    expect(parseCustomInteractions('this is not tabular', 'mine').error).toBeTruthy();
  });

  it('reads a paste that came out of a spreadsheet as spaces', () => {
    // A separator complaint is not a data complaint.
    expect(accessionsIn('#ID_A ID_B\nP49736 Q99741\n')).toEqual(['P49736', 'Q99741']);
  });

  it('keeps the good lines and names the bad ones', () => {
    const parsed = parseCustomInteractions(
      '#ID_A\tID_B\nP49736\tQ99741\nP25205\nP33993\tQ14566\n',
      'mine'
    );
    expect(parsed.interactors.entities.length, 'the two good pairs').toBe(4);
    expect(parsed.warnings.join(' '), 'and line 3 named').toMatch(/Skipped 1 line.*\(3\)/);
  });

  it('gives every interaction a score, so the confidence filter cannot hide it', () => {
    // The service assigns 1.0 to uploaded tuples -- measured -- and the
    // threshold hides anything with no score at all, so this has to match.
    const [entity] = parseCustomInteractions('#ID_A\tID_B\nP49736\tQ99741\n', 'mine').interactors
      .entities;
    expect(entity.interactors[0].score).toBe(1);
  });

  it('says there is nothing to read rather than drawing an empty overlay', () => {
    expect(parseCustomInteractions('   \n\n', 'mine').error).toBeTruthy();
  });
});

describe('counting what the reader actually gave', () => {
  // Three faults found by probing this module rather than by any failure. Each
  // produced a badge that overstated the data, and the last produced no badge
  // at all while looking like a clean parse.

  it('counts a pair listed twice once', () => {
    // Was A:2 and B:2 for a single interaction stated twice.
    const parsed = parseCustomInteractions('#ID_A\tID_B\nP49736\tQ99741\nP49736\tQ99741\n', 'mine');
    expect(parsed.interactors.entities.map((entity) => (entity.interactors ?? []).length)).toEqual([
      1, 1,
    ]);
    expect(parsed.warnings.join(' '), 'and says it did').toMatch(/repeated pair/i);
  });

  it('counts a pair listed the other way round once', () => {
    // A-B and B-A are the same interaction; the file may state either.
    const parsed = parseCustomInteractions('#ID_A\tID_B\nP49736\tQ99741\nQ99741\tP49736\n', 'mine');
    expect(parsed.interactors.entities.map((entity) => (entity.interactors ?? []).length)).toEqual([
      1, 1,
    ]);
  });

  it('counts a self-interaction once, not twice', () => {
    // Was A:2, because the pair is held from both ends and both ends are A.
    const parsed = parseCustomInteractions('#ID_A\tID_B\nP49736\tP49736\n', 'mine');
    expect(parsed.interactors.entities.length).toBe(1);
    expect((parsed.interactors.entities[0].interactors ?? []).length).toBe(1);
  });

  it('matches the diagram whatever case the file is written in', () => {
    // The diagram carries UniProt accessions upper case and they are matched
    // exactly, so a lower-case file parsed cleanly and then drew nothing, with
    // nothing said. That is worse than a refusal: it reads as absent data.
    const parsed = parseCustomInteractions('#ID_A\tID_B\np49736\tq99741\n', 'mine');
    expect(parsed.interactors.entities.map((entity) => entity.acc).sort()).toEqual([
      'P49736',
      'Q99741',
    ]);
  });

  it('still reaches the count the service reported for a two-line file', () => {
    // The service answered {"interactors":4,"interactions":2}. Deduplicating
    // must not change that: these are two distinct pairs.
    const parsed = parseCustomInteractions('P49736\tQ99741\nP25205\tP33993\n', 'mine');
    expect(parsed.interactors.entities.length).toBe(4);
  });
});
