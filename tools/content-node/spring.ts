/**
 * Request parameters and path variables as Spring binds them (spec 014,
 * research R1 layer 3): the servlet's decoding, Spring's editors and
 * converters for booleans, numbers, enums and lists, with their 400 messages,
 * and the view and identity Java's message converter reads. Moved unchanged
 * from service.ts.
 */
import {
  JavaNumberFormat,
  caseInsensitive,
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
function booleanEditor(values) {
  const text = javaTrim(values.join(','));
  const is = (words) => words.some((word) => caseInsensitive(text, word) === 0);
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
 * One query parameter's values as Tomcat reads them, in order: the query is
 * split on '&' and each pair at its first '='; a pair with no name is skipped;
 * name and value are percent-decoded, '+' as a space, the bytes read as UTF-8
 * with U+FFFD for a bad sequence. A pair whose name or value holds a malformed
 * escape (`%zz`, a lone `%`) is dropped whole -- Tomcat logs it and carries on
 * -- which URLSearchParams does not do: it keeps the text as it is.
 */
export function servletParameter(query, name) {
  const values: string[] = [];
  for (const pair of String(query).split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    const key = servletDecode(at === -1 ? pair : pair.slice(0, at));
    const value = servletDecode(at === -1 ? '' : pair.slice(at + 1));
    if (key === null || value === null || key === '') continue;
    if (key === name) values.push(value);
  }
  return values;
}

/** Percent-decoding as Tomcat's query parser does it, or null when malformed. */
function servletDecode(text) {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '+') {
      bytes.push(0x20);
    } else if (char === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
    }
  }
  return javaUtf8(bytes);
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
  const value = javaTrim(values[0]).toLowerCase();
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
export function writerFor(request): [view: number, options: { jsog: boolean }] {
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
export function queryValues(request, name) {
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
export function springList(values) {
  if (values.length === 0) return null;
  if (values.length > 1) return [...values];
  if (values[0] === '') return [];
  return values[0].split(',').map(javaTrim);
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
  const [sent] = values;
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
export function requiredString(name) {
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
  const [sent] = values;
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
