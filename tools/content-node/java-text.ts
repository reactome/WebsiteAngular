/**
 * Java's text and number semantics, as the content service reproduces them
 * (spec 014, research R1 layer 1): case folding by Java's own table, String's
 * trims and split, Integer and Long parsing, the hashes Java's collections
 * order by. Moved unchanged from service.ts.
 */
import { readFileSync } from 'node:fs';
import { JavaHashMap } from './java-hashmap.ts';

/**
 * case-snapshot.json: each UTF-16 unit whose upper (or lower) case differs,
 * then that case -- unit, case, unit, case, ... (snapshot-case.ts).
 */
export interface CaseSnapshot {
  upper: number[];
  lower: number[];
}

/** case-snapshot.json, as two maps from a UTF-16 unit to its case, read on first use. */
let javaCase: { upper: Map<number, number>; lower: Map<number, number> } | undefined;

/**
 * String.CASE_INSENSITIVE_ORDER: per UTF-16 unit, equal if their upper cases
 * are, else ordered by the lower cases of those upper cases (so the long s, ſ,
 * sorts as s) -- each the JVM's Character mapping
 * (case-snapshot.json; snapshot-case.ts says why not JavaScript's).
 */
export function caseInsensitive(a: string, b: string): number {
  if (!javaCase) {
    const { upper, lower } = JSON.parse(
      readFileSync(new URL('./case-snapshot.json', import.meta.url), 'utf8')
    ) as CaseSnapshot;
    const pairs = (flat: number[]) =>
      new Map(
        flat.flatMap((unit, at) => (at % 2 ? [] : [[unit, flat[at + 1]] as [number, number]]))
      );
    javaCase = { upper: pairs(upper), lower: pairs(lower) };
  }
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at += 1) {
    const x = a.charCodeAt(at);
    const y = b.charCodeAt(at);
    if (x === y) continue;
    const upperX = javaCase.upper.get(x) ?? x;
    const upperY = javaCase.upper.get(y) ?? y;
    const lowerX = javaCase.lower.get(upperX) ?? upperX;
    const lowerY = javaCase.lower.get(upperY) ?? upperY;
    if (lowerX !== lowerY) return lowerX - lowerY;
  }
  return a.length - b.length;
}

/** Long.hashCode, as an int: the value's two halves XORed. */
function longHash(value: number) {
  const big = BigInt.asUintN(64, BigInt(value));
  return Number(BigInt.asIntN(32, big ^ (big >> 32n)));
}

/**
 * graph-core's DatabaseObject.hashCode: dbId, then stId, then displayName,
 * 31 apart, 0 for a missing one. Equal objects (the same three) are one.
 */
function databaseObjectHash({
  dbId,
  stId,
  displayName,
}: {
  dbId: number | null;
  stId: string | null;
  displayName: string | null;
}) {
  let result = dbId == null ? 0 : longHash(dbId);
  result = (Math.imul(31, result) + (stId == null ? 0 : JavaHashMap.stringHash(stId))) | 0;
  return (
    (Math.imul(31, result) + (displayName == null ? 0 : JavaHashMap.stringHash(displayName))) | 0
  );
}

/** A java.util.HashSet of DatabaseObjects, in its iteration order. */
export function databaseObjectSet<T extends { properties: Record<string, unknown> }>(
  objects: T[]
): T[] {
  const byKey = new Map<string, T>();
  const keyOf = (object: T) => {
    const { dbId, stId, displayName } = object.properties;
    return JSON.stringify([dbId ?? null, stId ?? null, displayName ?? null]);
  };
  const set = new JavaHashMap<string, boolean>({
    hash: (key: string) => {
      // As keyOf wrote them: the graph's dbId, stId and displayName, or null.
      const [dbId, stId, displayName] = JSON.parse(key) as [
        number | null,
        string | null,
        string | null,
      ];
      return databaseObjectHash({ dbId, stId, displayName });
    },
  });
  for (const object of objects) {
    const key = keyOf(object);
    if (!byKey.has(key)) byKey.set(key, object);
    set.set(key, true);
  }
  // Every key in the set was put in byKey first.
  return [...set.keys()].map((key) => byKey.get(key) as T);
}

/**
 * Java's String.trim: every character up to U+0020 off both ends, control
 * characters included, and nothing above it -- a no-break space stays.
 */
export function javaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end -= 1;
  return text.slice(start, end);
}

/**
 * StringUtils.isNumeric, which Java's id and species readers use: non-empty,
 * and every UTF-16 unit a decimal digit. Per unit rather than per code point,
 * because that is what Java tests -- a digit outside the BMP (U+1D7CF) is a
 * surrogate pair to it, and neither half is a digit.
 */
export function javaNumeric(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (!/\p{Nd}/u.test(String.fromCharCode(text.charCodeAt(i)))) return false;
  }
  return true;
}

/**
 * A run of digits from any script, as ASCII. Unicode keeps each script's
 * digits in contiguous runs from 0 to 9, some runs back to back, so a digit's
 * value is its distance from the start of its run, modulo ten.
 */
export function asciiDigits(digits: string): string {
  const isDigit = (code: number) => /\p{Nd}/u.test(String.fromCodePoint(code));
  return [...digits]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      let first = code;
      while (isDigit(first - 1)) first -= 1;
      return String((code - first) % 10);
    })
    .join('');
}

/**
 * Bytes to text as the JDK's UTF-8 decoder (sun.nio.cs.UTF_8, the one Tomcat
 * reads a path with) does with malformed input replaced: each malformed
 * sequence one U+FFFD, its length by the JDK's rules -- an encoded surrogate
 * (ED A0 80) is one, where the WHATWG decoder Node uses makes three -- and an
 * incomplete sequence at the end one more.
 */
export function javaUtf8(bytes: ArrayLike<number>): string {
  // Every read below is inside `bytes`: each branch checks how many are left.
  const byte = (at: number) => bytes[at] as number;
  const continuation = (b: number) => (b & 0xc0) === 0x80;
  const malformed3 = (b1: number, b2: number) =>
    (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || !continuation(b2);
  const malformed4 = (b1: number, b2: number) =>
    b1 > 0xf4 ||
    (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) ||
    (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) ||
    !continuation(b2);
  let text = '';
  let at = 0;
  while (at < bytes.length) {
    const b1 = byte(at);
    const left = bytes.length - at;
    if (b1 < 0x80) {
      text += String.fromCharCode(b1);
      at += 1;
    } else if (b1 >= 0xc2 && b1 <= 0xdf) {
      if (left < 2) break;
      if (!continuation(byte(at + 1))) {
        text += '\ufffd';
        at += 1;
        continue;
      }
      text += String.fromCharCode(((b1 & 0x1f) << 6) | (byte(at + 1) & 0x3f));
      at += 2;
    } else if (b1 >= 0xe0 && b1 <= 0xef) {
      if (left < 3) {
        if (left > 1 && malformed3(b1, byte(at + 1))) {
          text += '\ufffd';
          at += 1;
          continue;
        }
        break;
      }
      const [b2, b3] = [byte(at + 1), byte(at + 2)];
      if (malformed3(b1, b2) || !continuation(b3)) {
        text += '\ufffd';
        at += malformed3(b1, b2) ? 1 : 2;
        continue;
      }
      const char = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      text += char >= 0xd800 && char <= 0xdfff ? '\ufffd' : String.fromCharCode(char);
      at += 3;
    } else if (b1 >= 0xf0 && b1 <= 0xf7) {
      if (left < 4) {
        if (b1 > 0xf4 || (left > 1 && malformed4(b1, byte(at + 1)))) {
          text += '\ufffd';
          at += 1;
          continue;
        }
        if (left > 2 && !continuation(byte(at + 2))) {
          text += '\ufffd';
          at += 2;
          continue;
        }
        break;
      }
      const [b2, b3, b4] = [byte(at + 1), byte(at + 2), byte(at + 3)];
      const point = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      if (
        !continuation(b2) ||
        !continuation(b3) ||
        !continuation(b4) ||
        point < 0x10000 ||
        point > 0x10ffff
      ) {
        text += '\ufffd';
        at += malformed4(b1, b2) ? 1 : !continuation(b3) ? 2 : 3;
        continue;
      }
      text += String.fromCodePoint(point);
      at += 4;
    } else {
      text += '\ufffd';
      at += 1;
    }
  }
  // What is left is an incomplete sequence: one replacement for all of it.
  return at < bytes.length ? `${text}\ufffd` : text;
}

/** A java.lang.NumberFormatException, carrying Java's message. */
export class JavaNumberFormat extends Error {}

/**
 * Character.isWhitespace as the service's JVM has it: the space,
 * line and paragraph separators but the no-break ones, and the ASCII controls
 * \t-\r and \u001C-\u001F.
 */
const JAVA_WHITESPACE = new RegExp(
  `[${(
    [
      [0x09, 0x0d],
      [0x1c, 0x20],
      [0x1680, 0x1680],
      [0x2000, 0x2006],
      [0x2008, 0x200a],
      [0x2028, 0x2029],
      [0x205f, 0x205f],
      [0x3000, 0x3000],
    ] satisfies [number, number][]
  )
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g'
);

/**
 * An element a loop's bound says is there, which noUncheckedIndexedAccess
 * cannot see. Absent, this service has a bug: thrown, not read as undefined.
 */
export function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('read past the end of a list');
  return value;
}

/** Spring's StringUtils.trimAllWhitespace. */
export function javaTrimAll(text: string): string {
  return text.replace(JAVA_WHITESPACE, '');
}

/**
 * NumberUtils.parseNumber(text, Integer.class), or Long.class for 64 bits:
 * Integer's as a number, Long's as a bigint.
 */
export function javaParseInteger(text: string, bits?: 32): number;

export function javaParseInteger(text: string, bits: 64): bigint;

export function javaParseInteger(text: string, bits = 32): number | bigint {
  const trimmed = javaTrimAll(text);
  const at = trimmed.startsWith('-') ? 1 : 0;
  const hex =
    trimmed.startsWith('0x', at) || trimmed.startsWith('0X', at) || trimmed.startsWith('#', at);
  const value = hex ? javaDecode(trimmed, bits) : javaParseInt(trimmed, 10, bits);
  return bits === 32 ? Number(value) : value;
}

/** Integer.decode, or Long.decode, as far as parseNumber reaches it. */
function javaDecode(text: string, bits: number): bigint {
  if (text === '') throw new JavaNumberFormat('Zero length string');
  let index = 0;
  let radix = 10;
  const negative = text[0] === '-';
  if (negative || text[0] === '+') index += 1;
  if (text.startsWith('0x', index) || text.startsWith('0X', index)) {
    index += 2;
    radix = 16;
  } else if (text.startsWith('#', index)) {
    index += 1;
    radix = 16;
  } else if (text.startsWith('0', index) && text.length > 1 + index) {
    index += 1;
    radix = 8;
  }
  if (text.startsWith('-', index) || text.startsWith('+', index)) {
    throw new JavaNumberFormat('Sign character in wrong position');
  }
  const rest = text.slice(index);
  try {
    const result = javaParseInt(rest, radix, bits);
    return negative ? BigInt.asIntN(bits, -result) : result;
  } catch (failure) {
    if (!(failure instanceof JavaNumberFormat)) throw failure;
    // Java retries with the sign attached, for the one value that needs it
    // (-0x80000000), and that attempt's message is the one reported.
    return javaParseInt(negative ? `-${rest}` : rest, radix, bits);
  }
}

/**
 * Integer.parseInt(text, radix), or Long.parseLong for 64 bits, as the
 * service's JVM has them, per UTF-16 unit. A bigint either way.
 */
export function javaParseInt(text: string, radix: number, bits: number): bigint {
  const refuse = (): never => {
    throw new JavaNumberFormat(`For input string: "${text}"`);
  };
  if (text.length === 0) refuse();
  const min = -(1n << BigInt(bits - 1));
  let i = 0;
  let negative = false;
  let limit = min + 1n;
  // Not empty: refused above.
  if (text.charAt(0) < '0') {
    if (text.charAt(0) === '-') {
      negative = true;
      limit = min;
    } else if (text.charAt(0) !== '+') refuse();
    if (text.length === 1) refuse();
    i += 1;
  }
  const base = BigInt(radix);
  const multmin = limit / base;
  let result = 0n;
  while (i < text.length) {
    const digit = javaDigit(text.charAt(i), radix);
    i += 1;
    if (digit < 0 || result < multmin) refuse();
    result *= base;
    if (result < limit + BigInt(digit)) refuse();
    result -= BigInt(digit);
  }
  return negative ? result : -result;
}

/**
 * Character.digit(char, radix): a decimal digit of any script, and for hex the
 * Latin letters A-F in either case, fullwidth ones included.
 */
function javaDigit(char: string, radix: number): number {
  const code = char.charCodeAt(0);
  if (radix === 16) {
    for (const start of [0x41, 0x61, 0xff21, 0xff41]) {
      if (code >= start && code <= start + 5) return code - start + 10;
    }
  }
  if (!/\p{Nd}/u.test(char)) return -1;
  const value = Number(asciiDigits(char));
  return value < radix ? value : -1;
}

/** String.split on a literal or a pattern, as Java's: trailing empty strings removed. */
export function javaSplit(text: string, separator: string | RegExp): string[] {
  const parts = text.split(separator);
  // No separator at all is the text itself, even empty; otherwise every
  // trailing empty string goes, so "," is nothing at all.
  if (parts.length === 1) return parts;
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** A java.util.HashSet of these strings, added in this order, as its iteration order. */
export function hashSetOf(items: Iterable<string>) {
  const map = new JavaHashMap();
  for (const item of items) map.set(item, true);
  return map;
}
