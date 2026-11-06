/**
 * reaction-exporter's TextUtils (research D22, step 2): the size of an
 * entity's name once fitted into lines at the 7:3 ratio, measured with the
 * widths Java's font metrics give (text-widths.ts).
 */
import { JavaNullPointerException } from './model.ts';
import { LINE_HEIGHT, MISSING_WIDTH, WIDTH_RUNS } from './text-widths.ts';

/** TextUtils.RATIO: width to height, (4/3)^3 rounded to 7/3. */
export const RATIO = 7 / 3;

/** The characters a word is split after when it does not fit a line. */
const WORD_SPLIT_CHARS = new Set([':', '.', '-', ',', ')', '/', '+']);

/** One code point's width: its run's, or the missing glyph's. */
function codePointWidth(codePoint: number): number {
  let low = 0;
  let high = WIDTH_RUNS.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last, width] = WIDTH_RUNS[middle] as readonly [number, number, number];
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return width;
  }
  return MISSING_WIDTH;
}

/**
 * FontMetrics.stringWidth: the sum of the code points' widths -- as Java
 * measures every name in release 98 (D21), complex scripts apart.
 */
export function textWidth(text: string | null): number {
  // A name the graph lacks: stringWidth(null) is Java's NullPointerException.
  if (text === null) throw new JavaNullPointerException();
  let width = 0;
  for (const character of text) width += codePointWidth(character.codePointAt(0) as number);
  return width;
}

/** The height of `lines` lines. */
const linesHeight = (lines: number) => lines * LINE_HEIGHT;

/**
 * textDimension: the smallest height, from two lines up in steps of one,
 * whose box at the ratio holds the text; its width and height rounded up,
 * as java.awt.Dimension takes them.
 */
export function textDimension(text: string): { width: number; height: number } {
  let h = 2 * LINE_HEIGHT;
  let w = h * RATIO;
  while (fit(text, w, h) === null) {
    h += LINE_HEIGHT;
    w = h * RATIO;
  }
  w = h * RATIO;
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

/**
 * fit: the text's lines when it fits in maxWidth by maxHeight, null when it
 * does not -- word by word, a word too long for the line split after its
 * punctuation and its parts carried over as they fit.
 */
function fit(text: string, maxWidth: number, maxHeight: number): string[] | null {
  if (textWidth(text) < maxWidth && linesHeight(1) < maxHeight) return [text];
  const lines: string[] = [];
  const words = javaSplitOnSpace(javaTrim(text));
  let line = '';
  for (const word of words) {
    let temp = line === '' ? word : `${line} ${word}`;
    if (textWidth(temp) < maxWidth) {
      line = temp;
      continue;
    }
    let firstPart = true;
    for (const part of splitWord(word)) {
      // A part that cannot fit a line means the text does not fit.
      if (textWidth(part) > maxWidth) return null;
      if (line === '') temp = part;
      else if (firstPart) temp = `${line} ${part}`;
      else temp = line + part;
      if (textWidth(temp) < maxWidth) line = temp;
      else {
        // The line so far -- even an empty one -- is closed, and the part starts the next.
        lines.push(line);
        line = part;
        if (linesHeight(lines.length) > maxHeight) return null;
      }
      firstPart = false;
    }
  }
  if (line !== '') lines.push(line);
  return linesHeight(lines.length) > maxHeight ? null : lines;
}

/**
 * split: a word cut after each of WORD_SPLIT_CHARS, the character kept at
 * the end of its part -- "p-T402-PAK2(213-524)" is p-, T402-, PAK2(213-, 524).
 */
function splitWord(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let at = 0; at < word.length; at += 1) {
    if (WORD_SPLIT_CHARS.has(word.charAt(at))) {
      parts.push(word.substring(start, at + 1));
      start = at + 1;
    }
  }
  if (start < word.length) parts.push(word.substring(start));
  return parts;
}

/** String.trim: every character at or below U+0020 off both ends. */
function javaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end -= 1;
  return text.substring(start, end);
}

/** String.split(" "): on each space, trailing empty parts dropped; "" alone is [""]. */
function javaSplitOnSpace(text: string): string[] {
  const parts = text.split(' ');
  if (text === '') return [''];
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length === 1 && parts[0] === '') return [];
  return parts;
}
