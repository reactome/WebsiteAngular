/**
 * Request parameters and path variables as Spring binds them (spec 014,
 * research R1 layer 3): the servlet's decoding, Spring's editors and
 * converters for booleans, numbers, enums and lists, with their 400 messages,
 * and the view and identity Java's message converter reads. Moved unchanged
 * from service.ts.
 */
import { randomInt } from 'node:crypto';
import type { Answer, Request } from './endpoint.ts';
import { mediaType, mediaTypeText } from './body.ts';
import type { MediaType } from './body.ts';
import {
  JavaNumberFormat,
  caseInsensitive,
  javaParseDouble,
  javaParseInt,
  javaParseInteger,
  javaTrim,
  javaTrimAll,
  javaUtf8,
  present,
} from './java-text.ts';
import { VIEW } from './domain.ts';

/**
 * The id as Spring hands it to a controller, from the path segment as it was
 * sent, decoded as Tomcat decodes it (javaPathDecode): Express decodes
 * `request.params` its own way, so the raw segment is read instead (nginx
 * passes the request's own URI through). A raw ';' never gets this far.
 */
export function pathId(segment: string): string {
  return javaPathDecode(String(segment));
}

/**
 * A path segment percent-decoded as Tomcat decodes it: the bytes read as
 * UTF-8, each malformed sequence U+FFFD -- Java answers person/%FF with "No
 * person found for id: \ufffd". decodeURIComponent throws on those instead.
 */
function javaPathDecode(text: string): string {
  if (!text.includes('%')) return text;
  const bytes: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(at + 1, at + 3))) {
      bytes.push(parseInt(text.slice(at + 1, at + 3), 16));
      at += 2;
    } else {
      // Defined: `at` is inside the text.
      const code = text.codePointAt(at) as number;
      if (code > 0xffff) at += 1;
      bytes.push(...Buffer.from(String.fromCodePoint(code), 'utf8'));
    }
  }
  return javaUtf8(bytes);
}

/** The raw, undecoded path segment at `index` (`/ContentService/data/query/{id}` is 4). */
export function rawSegment(request: { originalUrl?: unknown }, index: number): string {
  return (
    String(request.originalUrl ?? '')
      .split('?')[0]
      ?.split('/')[index] ?? ''
  );
}

/**
 * Spring's second try when its converter refuses a Boolean: CustomBooleanEditor
 * on every value joined by ',', trimmed, compared with equalsIgnoreCase --
 * for which the long s, ſ, is s, so "yeſ" is true. Undefined when that fails
 * too, and the converter's 400 stands. Measured against Java.
 */
function booleanEditor(values: string[]): boolean | undefined {
  const text = javaTrim(values.join(','));
  const is = (words: string[]) => words.some((word) => caseInsensitive(text, word) === 0);
  if (is(['true', 'on', 'yes', '1'])) return true;
  if (is(['false', 'off', 'no', '0'])) return false;
  return undefined;
}

/**
 * A request parameter as Spring binds it: the value, or the message of the
 * 400 Spring answers when it cannot convert it.
 */
export type Bound<T, Failed = unknown> =
  { value: T; error?: undefined } | ({ error: string; value?: undefined } & Failed);

/**
 * A `Boolean` request parameter as Spring converts it (StringToBooleanConverter):
 * the first value decides, trimmed as String.trim trims; empty is absent; true,
 * on, yes and 1 or false, off, no and 0 in any case; anything else gets
 * Spring's second try (booleanEditor), and failing that Java's 400.
 *
 * The 400 names what Spring was given: one value is a String, named as sent;
 * several are a String[], and the message lists all of them joined by ','
 * (untrimmed) even though only the first was read. A refused later value
 * changes nothing -- `true&foo` is true. All measured against Java.
 */
export function springBoolean(values: string[]): Bound<boolean | undefined> {
  const [raw] = values;
  if (raw === undefined) return { value: undefined };
  const value = javaTrim(raw).toLowerCase();
  if (value === '') return { value: undefined };
  if (['true', 'on', 'yes', '1'].includes(value)) return { value: true };
  if (['false', 'off', 'no', '0'].includes(value)) return { value: false };
  const edited = booleanEditor(values);
  if (edited !== undefined) return { value: edited };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Boolean'; ` +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${values.join(',')}]`,
  };
}

/**
 * An `Integer` request parameter as Spring binds it, given its values as the
 * servlet reads them (queryValues). Measured against Java case by case:
 *
 * - none is Spring's "not present" 400; an empty first value converts to null,
 *   which is its "present but converted to null" 400.
 * - the ConversionService reads the first value with NumberUtils.parseNumber:
 *   every Java whitespace character removed (anywhere, not just the ends),
 *   then `0x`, `0X` or `#` after an optional '-' is Integer.decode's hex, and
 *   anything else Integer.valueOf -- a '+' sign, leading zeros and digits of
 *   any script accepted.
 * - when that fails Spring tries again with the CustomNumberEditor, on the
 *   value -- or all of them joined by ',' -- which reads blank as null and
 *   otherwise parses the same way. The NumberFormatException of that second
 *   attempt is the 400's message, naming String or String[].
 */
export function springInteger(values: string[], name: string): Bound<number> {
  const required = `Required request parameter '${name}' for method parameter type Integer`;
  if (values.length === 0) return { error: `${required} is not present` };
  const empty = { error: `${required} is present but converted to null` };
  const attempt = (text: string): { value: number } | { failure: string } => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };

  const first = present(values[0]);
  if (first === '') return empty;
  const converted = attempt(first);
  if ('value' in converted) return converted;

  const text = values.join(',');
  if (javaTrimAll(text) === '') return empty;
  const retried = attempt(text);
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Integer'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/**
 * Every parameter of a query (or a URL-encoded form body) as Tomcat reads
 * them, by name, each name's values in order: the text is split on '&' and
 * each pair at its first '='; a pair with no name is skipped; name and value
 * are percent-decoded, '+' as a space, the bytes read as UTF-8 with U+FFFD
 * for a bad sequence. A pair whose name or value holds a malformed escape
 * (`%zz`, a lone `%`) is dropped whole -- Tomcat logs it and carries on --
 * which URLSearchParams does not do: it keeps the text as it is. One pass,
 * in time linear in the text: read once, every name is to hand.
 */
export function servletParameters(query: string): Map<string, string[]> {
  return parameterMap(servletPairs(query));
}

/** Each parameter servletParameters reads, as a name and a value, in order. */
function servletPairs(query: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const pair of String(query).split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    const key = servletDecode(at === -1 ? pair : pair.slice(0, at));
    const value = servletDecode(at === -1 ? '' : pair.slice(at + 1));
    if (key === null || value === null || key === '') continue;
    pairs.push([key, value]);
  }
  return pairs;
}

/** Parameters by name, each name's values in order. */
function parameterMap(pairs: [string, string][]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    const values = found.get(key);
    if (values) values.push(value);
    else found.set(key, [value]);
  }
  return found;
}

/** One parameter's values, as servletParameters reads them. */
export function servletParameter(query: string, name: string): string[] {
  return servletParameters(query).get(name) ?? [];
}

/** A hexadecimal digit's value, or -1 (NaN, past the text's end, included). */
function hexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x37;
  if (code >= 0x61 && code <= 0x66) return code - 0x57;
  return -1;
}

/**
 * Percent-decoding as Tomcat's query parser does it, or null when malformed:
 * into bytes, then read as UTF-8. Any other character goes in as its UTF-8,
 * one UTF-16 unit at a time, so a surrogate -- even one of a pair -- is
 * EF BF BD, as Node's encoder writes a lone one: what this always did.
 */
function servletDecode(text: string): string | null {
  // At most three bytes for each unit of the text.
  const bytes = new Uint8Array(text.length * 3);
  let size = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x2b) {
      bytes[size++] = 0x20;
    } else if (code === 0x25) {
      const high = hexDigit(text.charCodeAt(i + 1));
      const low = hexDigit(text.charCodeAt(i + 2));
      if (high < 0 || low < 0) return null;
      bytes[size++] = high * 16 + low;
      i += 2;
    } else if (code < 0x80) {
      bytes[size++] = code;
    } else if (code < 0x800) {
      bytes[size++] = 0xc0 | (code >> 6);
      bytes[size++] = 0x80 | (code & 0x3f);
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes[size++] = 0xef;
      bytes[size++] = 0xbf;
      bytes[size++] = 0xbd;
    } else {
      bytes[size++] = 0xe0 | (code >> 12);
      bytes[size++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[size++] = 0x80 | (code & 0x3f);
    }
  }
  return javaUtf8(bytes.subarray(0, size));
}

/**
 * A primitive `boolean` request parameter with a default, as Spring reads it:
 * absent or empty takes the default; otherwise as springBoolean reads a
 * Boolean, except that blank is no longer "absent" but a value Spring cannot
 * put in a primitive -- its 400, naming `boolean`, once booleanEditor has
 * also refused it. Measured against Java's
 * /query/enhanced/v2.
 */
export function springPrimitiveBoolean(values: string[], fallback: boolean): Bound<boolean> {
  // Only one empty value is Spring's "absent": repeated, the array is converted.
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  const value = javaTrim(values[0] ?? '').toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(value)) return { value: true };
  if (['false', 'off', 'no', '0'].includes(value)) return { value: false };
  const edited = booleanEditor(values);
  if (edited !== undefined) return { value: edited };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'boolean'; ` +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${values.join(',')}]`,
  };
}

/**
 * A primitive `int` request parameter with a default, as Spring reads it:
 * absent or empty takes the default; otherwise the first value parsed as
 * NumberUtils.parseNumber does (see springInteger), then all of them joined;
 * failing both, the 400 names `int` and the second attempt's message.
 */
export function springIntWithDefault(values: string[], fallback: number): Bound<number> {
  // Only one empty value is Spring's "absent": repeated, the array is converted.
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  const attempt = (text: string): { value: number } | { failure: string } => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };
  const converted = attempt(present(values[0]));
  if ('value' in converted) return converted;
  const retried = attempt(values.join(','));
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'int'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/**
 * An `Integer` request parameter with a default, as Spring binds it: none, or
 * one empty value, is the default; otherwise the first value converts -- an
 * empty one to null -- and failing that, all of them joined, which with no
 * text is null too. A null is the caller's to answer.
 */
export function springIntegerWithDefault(
  values: string[],
  fallback: number | null
): Bound<number | null> {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  if (values[0] === '') return { value: null };
  const attempt = (text: string): { value: number } | { failure: string } => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };
  const converted = attempt(present(values[0]));
  if ('value' in converted) return converted;
  const text = values.join(',');
  if (javaTrimAll(text) === '') return { value: null };
  const retried = attempt(text);
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Integer'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/**
 * A `Long` path variable as Spring binds it: the ConversionService's
 * NumberUtils.parseNumber (see springInteger), then the CustomNumberEditor on
 * the same text, which reads one with no text as null -- for a path variable,
 * Java's 500. Otherwise the 400 names the second attempt's failure.
 */
export function springPathLong(text: string, name: string): Bound<bigint, { status: 400 | 500 }> {
  try {
    return { value: javaParseInteger(text, 64) };
  } catch (failure) {
    if (!(failure instanceof JavaNumberFormat)) throw failure;
    if (javaTrimAll(text) === '')
      return {
        status: 500,
        error: `Required URI template variable '${name}' for method parameter type Long is present but converted to null`,
      };
    return {
      status: 400,
      error:
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Long'; " +
        `nested exception is java.lang.NumberFormatException: ${failure.message}`,
    };
  }
}

/**
 * CustomMessageConverter.getObjectWriter: the view and identity Java writes
 * domain objects with, from `?view=` and `?includeRef=`, as writeDomain's
 * arguments. getParameter is the first value; Boolean.parseBoolean ignores case.
 */
export function writerFor(request: {
  originalUrl?: unknown;
}): [view: number, options: { jsog: boolean }] {
  const [view] = queryValues(request, 'view');
  const [includeRef] = queryValues(request, 'includeRef');
  return [
    view === 'nested'
      ? VIEW.nested
      : view === 'nested-aggregated'
        ? VIEW.nestedAggregated
        : VIEW.flatten,
    { jsog: String(includeRef).toLowerCase() === 'true' },
  ];
}

/** The values of one query parameter as the servlet reads them, in order. */
export function queryValues(request: { originalUrl?: unknown }, name: string): string[] {
  const url = String(request.originalUrl ?? '');
  const at = url.indexOf('?');
  return servletParameter(at === -1 ? '' : url.slice(at + 1), name);
}

/**
 * A `List<String>` request parameter as Spring binds it: absent is null; one
 * value is split at commas and each part trimmed (StringToCollectionConverter
 * -- so "" is the empty list); several are taken as they are, neither split
 * nor trimmed. Measured against Java's /search/facet_query.
 */
export function springList(values: string[]): string[] | null {
  if (values.length === 0) return null;
  if (values.length > 1) return [...values];
  // One value, so `only` is it.
  const [only = ''] = values;
  if (only === '') return [];
  return only.split(',').map(javaTrim);
}

const SCOPES = ['REFERENCE_ENTITY', 'PHYSICAL_ENTITY', 'BOTH'];

/**
 * The `scope` parameter, a Query.Scope defaulting to PHYSICAL_ENTITY (or
 * `fallback`), as
 * Spring converts it, measured: absent or one empty value takes the default.
 * One value is trimmed, and blank is null -- which search-core's
 * configureScope cannot switch on: Java's 500 (null here). Of several, the
 * first is converted by StringToEnumConverterFactory, for which only an
 * exactly empty value is null; anything else is trimmed and must be a
 * constant's exact name. The 400 quotes the value as sent and names the
 * constant it looked for, trimmed.
 */
export function springScope(values: string[], fallback = 'PHYSICAL_ENTITY'): Bound<string | null> {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) {
    return { value: fallback };
  }
  const [sent = ''] = values;
  const name = javaTrim(sent);
  if (values.length === 1 ? name === '' : sent === '') return { value: null };
  if (SCOPES.includes(name)) return { value: name };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'org.reactome.server.search.domain.Query$Scope'; ` +
      'nested exception is org.springframework.core.convert.ConversionFailedException: Failed to convert from type ' +
      '[java.lang.String] to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
      `org.reactome.server.search.domain.Query$Scope] for value '${sent}'; nested exception is ` +
      `java.lang.IllegalArgumentException: No enum constant org.reactome.server.search.domain.Query.Scope.${name}`,
  };
}

/** Spring's 400 for a missing required String parameter. */
export function requiredString(name: string): string {
  return `Required request parameter '${name}' for method parameter type String is not present`;
}

/**
 * An enum request parameter with a default, as Spring converts it -- the
 * same rules as springScope, for any enum: one blank value is null (Java's
 * code then fails on it), several take the first, and a name that is no
 * constant is the 400 naming it.
 */
export function springEnum(
  values: string[],
  fallback: string,
  javaType: string,
  constants: string[]
): Bound<string | null> {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  const [sent = ''] = values;
  const name = javaTrim(sent);
  if (values.length === 1 ? name === '' : sent === '') return { value: null };
  if (constants.includes(name)) return { value: name };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type '${javaType}'; ` +
      'nested exception is org.springframework.core.convert.ConversionFailedException: Failed to convert from type ' +
      '[java.lang.String] to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
      `${javaType}] for value '${sent}'; nested exception is ` +
      `java.lang.IllegalArgumentException: No enum constant ${javaType.replace('$', '.')}.${name}`,
  };
}

/**
 * What Spring makes of a request's Accept for a mapping that produces one
 * type, in the order it finds out:
 *
 *  - `not-acceptable`: Java's 406, "Could not find acceptable
 *    representation" -- a part it cannot read, or none compatible.
 *  - `failed`: a 500 while it sorts the accepted types to match the mapping,
 *    before the controller runs: a quality written `Q` (MediaType reads `q`
 *    in any case to sort, but checks it only by that exact name) that
 *    Double.parseDouble refuses, met as Java's sort meets it.
 *  - `write-failed`: a 500 once the controller has answered, when the
 *    accepted type's quality is copied onto the produced one and checked:
 *    such a `Q` refused there, or one outside 0 to 1.
 *  - `chosen`: the type the answer is written under.
 *
 * The header is split at commas outside quotes and each part read as
 * mediaType reads it; none at all is every type. Each accepted type
 * compatible with the produced one gives the more specific of the two -- the
 * accepted one, with its parameters, when it names the subtype -- and the
 * first of those, as Spring sorts them by specificity and quality, is
 * chosen, its `q` dropped. A quality, even 0, never refuses a type.
 */
export type Negotiation =
  | { kind: 'not-acceptable' }
  | { kind: 'failed'; message: string }
  | { kind: 'write-failed'; message: string }
  | { kind: 'chosen'; media: MediaType };

export function negotiate(
  header: string | undefined,
  produced: [type: string, subtype: string]
): Negotiation {
  const parts: string[] = [];
  if (header !== undefined) {
    let quoted = false;
    let start = 0;
    for (let at = 0; at < header.length; at += 1) {
      const char = header.charAt(at);
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        parts.push(header.slice(start, at));
        start = at + 1;
      } else if (char === '\\') at += 1;
    }
    parts.push(header.slice(start));
  }
  const accepted: MediaType[] = [];
  for (const part of parts) {
    if (javaTrimAll(part) === '') continue;
    const media = mediaType(part);
    if (typeof media === 'string') return { kind: 'not-acceptable' };
    accepted.push(media);
  }
  if (accepted.length === 0) accepted.push({ type: '*', subtype: '*', parameters: [] });
  const [type, subtype] = produced;
  const produce: MediaType = { type, subtype, parameters: [] };
  try {
    let sorted: MediaType[];
    try {
      sorted = javaSort(accepted, bySpecificityAndQuality);
    } catch (failure) {
      if (failure instanceof QualityFailure) return { kind: 'failed', message: failure.message };
      throw failure;
    }
    const compatibles = sorted.filter((media) => compatible(media, produce));
    if (compatibles.length === 0) return { kind: 'not-acceptable' };
    const usable = compatibles.map((media) => mostSpecific(media, produce));
    const [chosen] = javaSort(usable, bySpecificityAndQuality);
    if (!chosen) return { kind: 'not-acceptable' };
    // removeQualityValue: asked case-insensitively, removed by its exact name.
    const hasQuality = chosen.parameters.some(([name]) => name.toLowerCase() === 'q');
    return {
      kind: 'chosen',
      media: hasQuality
        ? { ...chosen, parameters: chosen.parameters.filter(([name]) => name !== 'q') }
        : chosen,
    };
  } catch (failure) {
    if (failure instanceof QualityFailure)
      return { kind: 'write-failed', message: failure.message };
    throw failure;
  }
}

/** The IllegalArgumentException (a NumberFormatException among them) a quality throws in Java. */
class QualityFailure extends Error {}

/** A parameter's value as LinkedCaseInsensitiveMap.get finds it. */
function parameter(media: MediaType, name: string) {
  return media.parameters.find(([key]) => key.toLowerCase() === name)?.[1];
}

const unquoted = (text: string) =>
  /^(".*"|'.*')$/s.test(text) && text.length >= 2 ? text.slice(1, -1) : text;

/**
 * Double.parseDouble on a quality, or its NumberFormatException: "empty
 * String", or the text, trimmed, "For input string".
 */
function parseQuality(text: string): number {
  const value = javaParseDouble(text);
  if (value !== undefined) return value;
  const trimmed = javaTrim(text);
  throw new QualityFailure(trimmed === '' ? 'empty String' : `For input string: "${trimmed}"`);
}

/** MediaType.getQualityValue: `q` in any case, unquoted, parsed; 1 without one. */
function qualityOf(media: MediaType) {
  const text = parameter(media, 'q');
  return text === undefined ? 1 : parseQuality(unquoted(text));
}

/** Double.compare. */
function compareDoubles(one: number, other: number) {
  if (one < other) return -1;
  if (one > other) return 1;
  const [a, b] = [Object.is(one, -0) ? -0.5 : one, Object.is(other, -0) ? -0.5 : other];
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Double.compare(quality2, quality1), each read in Java's order. */
function byQualityValue(one: MediaType, other: MediaType) {
  const first = qualityOf(one);
  const second = qualityOf(other);
  return compareDoubles(second, first);
}

const isWildcardSubtype = (media: MediaType) =>
  media.subtype === '*' || media.subtype.startsWith('*+');

/** MediaType.SPECIFICITY_COMPARATOR: the more specific first, quality then parameters deciding a tie. */
function specificity(one: MediaType, other: MediaType): number {
  if (one.type === '*' && other.type !== '*') return 1;
  if (other.type === '*' && one.type !== '*') return -1;
  if (one.type !== other.type) return 0;
  if (isWildcardSubtype(one) && !isWildcardSubtype(other)) return 1;
  if (isWildcardSubtype(other) && !isWildcardSubtype(one)) return -1;
  if (one.subtype !== other.subtype) return 0;
  const quality = byQualityValue(one, other);
  if (quality !== 0) return quality;
  return Math.sign(other.parameters.length - one.parameters.length);
}

/** MediaType.QUALITY_VALUE_COMPARATOR. */
function byQuality(one: MediaType, other: MediaType): number {
  const quality = byQualityValue(one, other);
  if (quality !== 0) return quality;
  if (one.type === '*' && other.type !== '*') return 1;
  if (other.type === '*' && one.type !== '*') return -1;
  if (one.type !== other.type) return 0;
  if (isWildcardSubtype(one) && !isWildcardSubtype(other)) return 1;
  if (isWildcardSubtype(other) && !isWildcardSubtype(one)) return -1;
  if (one.subtype !== other.subtype) return 0;
  return Math.sign(other.parameters.length - one.parameters.length);
}

/** sortBySpecificityAndQuality's comparator: SPECIFICITY_COMPARATOR.thenComparing(QUALITY_VALUE_COMPARATOR). */
const bySpecificityAndQuality = (one: MediaType, other: MediaType) =>
  specificity(one, other) || byQuality(one, other);

/**
 * List.sort as Java runs it on fewer than 32 items (TimSort's
 * countRunAndMakeAscending, then binarySort), comparing the same pairs in the
 * same order: Spring's comparators are no total order and may throw, so
 * another sort could order them otherwise, or meet another failure first.
 * A longer list is sorted the same way; Java's would merge runs (declared).
 */
function javaSort<T>(list: T[], compare: (one: T, other: T) => number): T[] {
  const a = [...list];
  const n = a.length;
  if (n < 2) return a;
  const at = (i: number) => a[i] as T;
  let runHi = 1;
  if (compare(at(runHi++), at(0)) < 0) {
    while (runHi < n && compare(at(runHi), at(runHi - 1)) < 0) runHi += 1;
    a.splice(0, runHi, ...a.slice(0, runHi).reverse());
  } else {
    while (runHi < n && compare(at(runHi), at(runHi - 1)) >= 0) runHi += 1;
  }
  for (let start = runHi; start < n; start += 1) {
    const pivot = at(start);
    let left = 0;
    let right = start;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (compare(pivot, at(mid)) < 0) right = mid;
      else left = mid + 1;
    }
    a.splice(start, 1);
    a.splice(left, 0, pivot);
  }
  return a;
}

/**
 * getMostSpecificMediaType: the produced type with the accepted one's
 * quality copied in -- checked there, by its exact name `q`, as a new
 * MediaType checks it -- or the accepted type where it is at least as
 * specific.
 */
function mostSpecific(accept: MediaType, produce: MediaType): MediaType {
  const quality = parameter(accept, 'q');
  if (quality === undefined) return specificity(accept, produce) <= 0 ? accept : produce;
  const value = unquoted(quality);
  const number = parseQuality(value);
  if (!(number >= 0 && number <= 1))
    throw new QualityFailure(`Invalid quality value "${value}": should be between 0.0 and 1.0`);
  const produceToUse: MediaType = {
    ...produce,
    parameters: [...produce.parameters, ['q', quality]],
  };
  return specificity(accept, produceToUse) <= 0 ? accept : produceToUse;
}

/** MimeType.isCompatibleWith, either way round. */
function compatible(one: MediaType, other: MediaType) {
  if (one.type === '*' || other.type === '*') return true;
  if (one.type !== other.type) return false;
  if (one.subtype === other.subtype) return true;
  if (!isWildcardSubtype(one) && !isWildcardSubtype(other)) return false;
  const suffix = (media: MediaType) => {
    const at = media.subtype.lastIndexOf('+');
    return at === -1 ? undefined : media.subtype.slice(at + 1);
  };
  if (one.subtype === '*' || other.subtype === '*') return true;
  const [oneSuffix, otherSuffix] = [suffix(one), suffix(other)];
  if (isWildcardSubtype(one) && oneSuffix !== undefined)
    return oneSuffix === other.subtype || oneSuffix === otherSuffix;
  if (isWildcardSubtype(other) && otherSuffix !== undefined)
    return one.subtype === otherSuffix || otherSuffix === oneSuffix;
  return false;
}

/**
 * The Content-Type Tomcat sends for the type Spring sets (MediaType's text),
 * the response's encoding being UTF-8 (Spring Boot forces it): as given with
 * `;charset=UTF-8` after it, unless Tomcat's own parser finds a charset in
 * it -- then rebuilt as that parser has it, parameter names lower-cased,
 * the charset unquoted and last.
 */
export function tomcatContentType(text: string): string {
  const parsed = tomcatMediaType(text);
  const charset = parsed?.parameters.get('charset');
  if (!parsed || charset === undefined) return `${text};charset=UTF-8`;
  const rest = [...parsed.parameters]
    .filter(([name]) => name !== 'charset')
    .map(([name, value]) => `;${name}=${value}`)
    .join('');
  const unquoted = charset.startsWith('"') ? tomcatUnquote(charset) : charset;
  return `${parsed.type}/${parsed.subtype}${rest};charset=${unquoted}`;
}

const TCHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/;

/** Tomcat's MediaType.parseMediaType (its HttpParser), or undefined where it gives up. */
function tomcatMediaType(text: string) {
  let at = 0;
  const skipSpace = () => {
    while (text.charAt(at) === ' ' || text.charAt(at) === '\t') at += 1;
  };
  const token = () => {
    skipSpace();
    const start = at;
    while (at < text.length && TCHAR.test(text.charAt(at))) at += 1;
    return text.slice(start, at);
  };
  // FOUND, NOT_FOUND, or EOF.
  const skip = (char: string) => {
    skipSpace();
    if (at >= text.length) return 'eof';
    if (text.charAt(at) !== char) return 'missing';
    at += 1;
    return 'found';
  };
  const quotedOrToken = (): string | undefined => {
    skipSpace();
    if (text.charAt(at) !== '"') {
      const read = token();
      return read === '' ? undefined : read;
    }
    let result = '"';
    at += 1;
    while (at < text.length) {
      const char = text.charAt(at);
      if (char === '\\') {
        result += char + text.charAt(at + 1);
        at += 2;
      } else if (char === '"') {
        at += 1;
        return `${result}"`;
      } else {
        result += char;
        at += 1;
      }
    }
    return undefined;
  };
  const type = token();
  if (type === '' || skip('/') !== 'found') return undefined;
  const subtype = token();
  if (subtype === '') return undefined;
  const parameters = new Map<string, string>();
  let semicolon = skip(';');
  if (semicolon === 'missing') return undefined;
  while (semicolon === 'found') {
    const name = token();
    let value: string | undefined = '';
    if (skip('=') === 'found') value = quotedOrToken();
    if (value === undefined) return undefined;
    parameters.set(name.toLowerCase(), value);
    semicolon = skip(';');
    if (semicolon === 'missing') return undefined;
  }
  return { type, subtype, parameters };
}

/** HttpParser.unquote: the quotes off, each backslash escape its character. */
function tomcatUnquote(text: string) {
  return text.slice(1, -1).replace(/\\(.)/gs, '$1');
}

/**
 * The type StringHttpMessageConverter writes a String under, and the
 * charset it encodes it in: the chosen type with UTF-8 put in as its last
 * parameter unless it names a `charset` (by that exact name, as Spring reads
 * it). Spring then reads that type back from the response's headers, as
 * mediaType reads it, and encodes in the charset it finds there; a type that
 * does not read back -- a value holding an escaped quote, which then takes
 * the added charset into it -- is its 500, the failure's message.
 */
export function stringContentType(
  media: MediaType
): { type: string; charset: string } | { failure: string } {
  const own = media.parameters.some(([name]) => name === 'charset');
  const text = mediaTypeText(
    own
      ? media
      : {
          ...media,
          parameters: [
            ...media.parameters.filter(([name]) => name.toLowerCase() !== 'charset'),
            ['charset', 'UTF-8'],
          ],
        }
  );
  const back = mediaType(text);
  if (typeof back === 'string') return { failure: back };
  const charset = back.parameters.find(([name]) => name === 'charset')?.[1] ?? 'UTF-8';
  return { type: tomcatContentType(text), charset: unquoted(charset) };
}

/** Tomcat's maxPostSize: a form body longer than this is not read for parameters. */
export const MAX_POST_SIZE = 2 * 1024 * 1024;

/** Tomcat's maxParameterCount: the parameters past it, the query's first, are dropped. */
const MAX_PARAMETER_COUNT = 10_000;

/**
 * A request's parameters as the servlet has them: the query's, then a POST
 * body's when its Content-Type, up to any ';' and trimmed, is exactly
 * application/x-www-form-urlencoded -- Tomcat compares it by case -- and
 * the body is no longer than maxPostSize; of them all, the first
 * maxParameterCount. The body's bytes are decoded as UTF-8, as the query's
 * are: Spring Boot forces the request's encoding.
 */
export function servletRequestParameters(request: Request): (name: string) => string[] {
  const url = String(request.originalUrl ?? '');
  const at = url.indexOf('?');
  const query = servletPairs(at === -1 ? '' : url.slice(at + 1));
  const header = request.get?.('content-type') ?? '';
  const media = javaTrim(header.split(';')[0] ?? '');
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  const form =
    media === 'application/x-www-form-urlencoded' &&
    !request.tooLarge &&
    body.length <= MAX_POST_SIZE
      ? // Every byte past ASCII as its escape, so a sequence split between a
        // raw byte and an escaped one decodes as Tomcat decodes it, by bytes.
        servletPairs(
          body
            .toString('latin1')
            .replace(
              /[\u0080-\u00ff]/g,
              (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
            )
        )
      : [];
  const pairs = query.concat(form);
  const found = parameterMap(pairs.slice(0, MAX_PARAMETER_COUNT));
  return (name) => found.get(name) ?? [];
}

/**
 * A Spring Resource as a controller's answer: the bytes under the type
 * negotiate chose, as Tomcat writes it, with `Accept-Ranges: bytes`, and a Range header honoured as
 * AbstractMessageConverterMethodProcessor honours it, whatever the method.
 * One range is a 206 with its Content-Range; several (or `bytes=` with
 * none) the multipart/byteranges Spring writes, under a boundary of its
 * random kind. A range Spring cannot read or satisfy -- not `bytes=`, a
 * number Long.parseLong refuses, a start past the end, over a hundred
 * ranges, or several adding up to the whole -- is a 416 with the whole body,
 * as Java sends it.
 */
export function resourceAnswer(request: Request, bytes: Buffer, media: MediaType): Answer {
  const spring = mediaTypeText(media);
  const whole: Answer = {
    status: 200,
    type: tomcatContentType(spring),
    headers: { 'Accept-Ranges': 'bytes' },
    body: bytes,
  };
  // HttpHeaders.getFirst: the first Range sent, where Node joins them all.
  const raw = request.rawHeaders ?? [];
  const index = raw.findIndex((name, at) => at % 2 === 0 && name.toLowerCase() === 'range');
  const header = index === -1 ? undefined : raw[index + 1];
  if (header === undefined) return whole;
  const regions = rangeRegions(header, bytes.length);
  if (!regions)
    return {
      ...whole,
      status: 416,
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${bytes.length}` },
    };
  const [only] = regions;
  if (only && regions.length === 1) {
    const [start, end] = only;
    return {
      ...whole,
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
      },
      body: bytes.subarray(start, end + 1),
    };
  }
  const boundary = multipartBoundary();
  const parts = regions.map(([start, end]) =>
    Buffer.concat([
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Type: ${spring}\r\nContent-Range: bytes ${start}-${end}/${bytes.length}\r\n\r\n`,
        'latin1'
      ),
      bytes.subarray(start, end + 1),
    ])
  );
  return {
    ...whole,
    status: 206,
    type: tomcatContentType(`multipart/byteranges; boundary=${boundary}`),
    body: Buffer.concat([...parts, Buffer.from(`\r\n--${boundary}--`)]),
  };
}

/**
 * HttpRange.parseRanges then toResourceRegions over a body of `length`
 * bytes: each region's first and last byte, or undefined where either
 * throws IllegalArgumentException.
 */
function rangeRegions(header: string, length: number): [number, number][] | undefined {
  if (header === '') return [];
  if (!header.startsWith('bytes=')) return undefined;
  const tokens = header
    .slice('bytes='.length)
    .split(',')
    .map((token) => javaTrimWhitespace(token))
    .filter((token) => token !== '');
  if (tokens.length > 100) return undefined;
  const size = BigInt(length);
  const regions: [number, number][] = [];
  try {
    for (const token of tokens) {
      const dash = token.indexOf('-');
      let start: bigint;
      let end: bigint;
      if (dash > 0) {
        start = javaParseInt(token.slice(0, dash), 10, 64);
        const last =
          dash < token.length - 1 ? javaParseInt(token.slice(dash + 1), 10, 64) : undefined;
        if (start < 0n || (last !== undefined && last < start)) return undefined;
        end = last !== undefined && last < size ? last : size - 1n;
      } else if (dash === 0) {
        const suffix = javaParseInt(token.slice(1), 10, 64);
        if (suffix < 0n) return undefined;
        start = suffix < size ? size - suffix : 0n;
        end = size - 1n;
      } else return undefined;
      if (start >= size) return undefined;
      regions.push([Number(start), Number(end)]);
    }
  } catch (failure) {
    if (failure instanceof JavaNumberFormat) return undefined;
    throw failure;
  }
  if (regions.length > 1) {
    const total = regions.reduce((sum, [start, end]) => sum + end - start + 1, 0);
    if (total >= length) return undefined;
  }
  return regions;
}

/** StringUtils.trimWhitespace: Character.isWhitespace off both ends. */
function javaTrimWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  const white = (at: number) => javaTrimAll(text.charAt(at)) === '';
  while (start < end && white(start)) start += 1;
  while (end > start && white(end - 1)) end -= 1;
  return text.slice(start, end);
}

const BOUNDARY_CHARS = '-_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** MimeTypeUtils.generateMultipartBoundaryString: 30 to 40 of its characters, at random. */
function multipartBoundary(): string {
  const size = 30 + randomInt(11);
  return Array.from({ length: size }, () =>
    BOUNDARY_CHARS.charAt(randomInt(BOUNDARY_CHARS.length))
  ).join('');
}
