// @vitest-environment node
//
// TextUtils.textDimension, against the deployed reaction-exporter jar's own:
// Java printed these sizes for these names (a scratch program calling the
// jar under the service's OpenJDK 11, headless). The same run over every
// first name of release 98's physical entities, 96,310 of them, agreed.
import { describe, expect, it } from 'vitest';
import { JavaNullPointerException } from './model.ts';
import { textDimension, textWidth } from './text.ts';

/** [name, width, height], as the jar measured them. */
const JAVA: [name: string, width: number, height: number][] = [
  ['a', 47, 20],
  ['a  b', 47, 20],
  [' lead', 47, 20],
  ['trail ', 47, 20],
  ['p-T402-PAK2(213-524)', 70, 30],
  ['supercalifragilisticexpialidociousandthensomemoretext:withcolons.and-dashes', 210, 90],
  ['ATP', 47, 20],
  ['x', 47, 20],
  [
    'very long name with many words that will need several lines to fit inside the box at the ratio',
    94,
    40,
  ],
  ['A:B:C:D:E:F:G:H:I:J:K:L:M:N:O:P:Q:R:S:T:U:V:W:X:Y:Z', 94, 40],
  ['(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((', 234, 100],
  ["2'-deoxyguanosine 5'-monophosphate", 70, 30],
];

describe('textDimension, as the jar measures a name', () => {
  it("gives the jar's size for each case: spaces, punctuation, a word too long for any line", () => {
    for (const [name, width, height] of JAVA)
      expect(textDimension(name), JSON.stringify(name)).toEqual({ width, height });
  });

  it('measures a string as the sum of its characters, and a character the font lacks as 6', () => {
    expect(textWidth('ATP')).toBe(textWidth('A') + textWidth('T') + textWidth('P'));
    expect(textWidth('\u{4e00}')).toBe(6);
  });

  // A name the graph lacks: FontMetrics.stringWidth(null) is Java's
  // NullPointerException, which the endpoint answers with Java's 500, not a
  // TypeError of node's own.
  it('measures a missing name as Java does: a NullPointerException', () => {
    expect(() => textWidth(null)).toThrow(JavaNullPointerException);
    expect(() => textDimension(null as unknown as string)).toThrow(JavaNullPointerException);
  });
});
