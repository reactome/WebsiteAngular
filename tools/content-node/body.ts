/**
 * A text/plain request body as Spring reads it (spec 014, research R1 layer
 * 2): the charset from the Content-Type, decoded by Java's own decoders, and
 * the ids in it split as the controllers split them. Moved unchanged from
 * service.ts.
 */
import { readFileSync } from 'node:fs';
import { javaParseDouble, javaTrim, present } from './java-text.ts';
import { JavaHashMap } from './java-hashmap.ts';

/**
 * A text/plain body of ids as the controllers split it: String.split on , ;
 * newline or tab -- trailing empty strings dropped, as Java's split drops
 * them -- each trimmed.
 */
export function plainIds(body: string): string[] {
  const parts = body.split(/,|;|\n|\t/);
  if (parts.length > 1) while (parts.length && parts.at(-1) === '') parts.pop();
  return parts.map((part) => javaTrim(part));
}

/**
 * A media type as Spring's MimeTypeUtils and MediaType read one: type and
 * subtype lower-cased, the parameters by name as LinkedCaseInsensitiveMap
 * keeps them (a name given again in another case moves to the end, under
 * its last spelling).
 */
export interface MediaType {
  type: string;
  subtype: string;
  parameters: [name: string, value: string][];
}

/** HTTP's separators, which no token may hold (MimeType.TOKEN). */
const SEPARATORS = '()<>@,;:\\"/[]?={} \t';

/** MimeType.checkToken: the message for the first character no token may hold. */
function tokenProblem(token: string): string | undefined {
  for (let at = 0; at < token.length; at += 1) {
    const code = token.charCodeAt(at);
    if (code <= 0x1f || code >= 0x7f || SEPARATORS.includes(token.charAt(at)))
      return `Invalid token character '${token.charAt(at)}' in token "${token}"`;
  }
  return undefined;
}

const isQuoted = (value: string) =>
  value.length >= 2 &&
  ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")));
const unquote = (value: string) => (isQuoted(value) ? value.slice(1, -1) : value);

/** Charset.forName's legal names: a letter or digit, then those and - + : _ . */
const LEGAL_CHARSET = /^[A-Za-z0-9][A-Za-z0-9\-+:_.]*$/;

/**
 * MediaType.parseMediaType(text) as Spring 5.3 reads it, or the message of
 * the InvalidMediaTypeException it throws: "Invalid mime type" for what
 * MimeTypeUtils refuses -- no '/', a token holding a separator, an empty
 * parameter, a charset Java does not know -- and "Invalid media type" for a
 * quality MediaType refuses after it. Only `charset` and `q` in that case
 * are read as such, as Spring compares them.
 */
export function mediaType(text: string): MediaType | string {
  const mime = (why: string) => `Invalid mime type "${text}": ${why}`;
  if (text === '') return mime("'mimeType' must not be empty");
  let index = text.indexOf(';');
  let full = javaTrim(index >= 0 ? text.slice(0, index) : text);
  if (full === '') return mime("'mimeType' must not be empty");
  if (full === '*') full = '*/*';
  const slash = full.indexOf('/');
  if (slash === -1) return mime("does not contain '/'");
  if (slash === full.length - 1) return mime("does not contain subtype after '/'");
  const type = full.slice(0, slash);
  const subtype = full.slice(slash + 1);
  if (type === '*' && subtype !== '*')
    return mime("wildcard type is legal only in '*/*' (all mime types)");
  // The parameters, a ';' inside quotes not ending one. With no ';' at all
  // the whole text is read once as a parameter, as Spring reads it; a '='
  // there is in the type or subtype, refused as a token below.
  const given = new Map<string, string>();
  do {
    let next = index + 1;
    let quoted = false;
    while (next < text.length) {
      const char = text.charAt(next);
      if (char === ';' && !quoted) break;
      if (char === '"') quoted = !quoted;
      next += 1;
    }
    const parameter = javaTrim(text.slice(index + 1, next));
    const at = parameter.indexOf('=');
    if (at >= 0) given.set(javaTrim(parameter.slice(0, at)), javaTrim(parameter.slice(at + 1)));
    index = next;
  } while (index < text.length);
  if (type === '') return mime("'type' must not be empty");
  const problem = tokenProblem(type) ?? tokenProblem(subtype);
  if (problem) return mime(problem);
  const parameters: [string, string][] = [];
  for (const [name, value] of given) {
    if (name === '') return mime("'parameter' must not be empty");
    if (value === '') return mime("'value' must not be empty");
    const invalid = tokenProblem(name);
    if (invalid) return mime(invalid);
    if (name === 'charset') {
      const charset = unquote(value);
      if (!LEGAL_CHARSET.test(charset)) return mime(charset);
      if (!knownCharset(charset)) return mime(`unsupported charset '${charset}'`);
    } else if (!isQuoted(value)) {
      const token = tokenProblem(value);
      if (token) return mime(token);
    }
    const same = parameters.findIndex(([known]) => known.toLowerCase() === name.toLowerCase());
    if (same >= 0) parameters.splice(same, 1);
    parameters.push([name, value]);
  }
  // MediaType's own check, once MimeType has taken every parameter.
  const quality = parameters.find(([name]) => name === 'q');
  if (quality) {
    const value = unquote(quality[1]);
    const media = (why: string) => `Invalid media type "${text}": ${why}`;
    const number = javaParseDouble(value);
    if (number === undefined) return media(`For input string: "${value}"`);
    if (!(number >= 0 && number <= 1))
      return media(`Invalid quality value "${value}": should be between 0.0 and 1.0`);
  }
  return { type: type.toLowerCase(), subtype: subtype.toLowerCase(), parameters };
}

/** MediaType.toString: type/subtype, then each parameter as `;name=value`. */
export function mediaTypeText(media: MediaType): string {
  return `${media.type}/${media.subtype}${media.parameters.map(([name, value]) => `;${name}=${value}`).join('')}`;
}

/**
 * Whether Spring takes a Content-Type for a mapping's `consumes`: undefined
 * if so, else the 415's message. The header is read as mediaType reads it,
 * and only the types named are taken, as each includes it: `text/*` is not
 * text/plain. No header at all is "Content type ''".
 */
export function consumesProblem(
  header: string | undefined,
  consumable: [type: string, subtype: string][]
): string | undefined {
  if (!header) return "Content type '' not supported";
  const media = mediaType(header);
  if (typeof media === 'string') return media;
  if (consumable.some(([type, subtype]) => media.type === type && media.subtype === subtype))
    return undefined;
  return `Content type '${mediaTypeText(media)}' not supported`;
}

/** Whether Spring takes a Content-Type for `consumes = "text/plain"` (consumesProblem). */
export function plainTextProblem(header: string | undefined): string | undefined {
  return consumesProblem(header, [['text', 'plain']]);
}

/** charset-snapshot.json (snapshot-charsets.ts): a charset as the service's JVM has it. */
interface JavaCharset {
  name: string;
  aliases: string[];
  encode: 'ascii' | { prefix: string; chars: string[] } | null;
  table?: string;
  unread?: number[];
  low?: string;
}

let charsets: Map<string, JavaCharset> | undefined;

/**
 * The charset Charset.forName finds for a name -- its canonical name or any
 * alias, in any case -- or undefined where Java has none: Java's names, as
 * measured (charset-snapshot.json), not TextDecoder's.
 */
function javaCharset(name: string): JavaCharset | undefined {
  charsets ??= new Map(
    (
      JSON.parse(readFileSync(new URL('./charset-snapshot.json', import.meta.url), 'utf8')) as {
        charsets: JavaCharset[];
      }
    ).charsets.flatMap((charset) =>
      [charset.name, ...charset.aliases].map((key): [string, JavaCharset] => [
        key.toLowerCase(),
        charset,
      ])
    )
  );
  return charsets.get(name.toLowerCase());
}

function knownCharset(name: string) {
  return javaCharset(name) !== undefined;
}

/**
 * A text/plain body as StringHttpMessageConverter reads it: in the header's
 * charset, else UTF-8 -- Spring Boot gives the converter UTF-8 as its default,
 * not the class's own ISO-8859-1 (measured: Java reads C3 A9 as "é") -- a
 * malformed sequence read as U+FFFD. The charset is the parameter named
 * exactly `charset`, unquoted, as Spring finds it: `Charset=` names none.
 * Undefined where this cannot read the body as Java would (readerFor).
 */
export function plainText(body: Buffer, header?: string): string | undefined {
  const charset = javaCharset(plainTextCharset(header));
  return charset ? readerFor(charset, body)?.(body) : undefined;
}

/** The charset a text/plain Content-Type names for Spring, or UTF-8. */
function plainTextCharset(header?: string) {
  const media = header ? mediaType(header) : undefined;
  const own =
    typeof media === 'object'
      ? media.parameters.find(([name]) => name === 'charset')?.[1]
      : undefined;
  return own === undefined ? 'UTF-8' : unquote(own);
}

/**
 * Node's own answer, a 415, for a body in a charset Java reads and this
 * cannot: no Java message, since Java answers the request.
 */
export function unreadableCharset(header?: string) {
  const charset = javaCharset(plainTextCharset(header));
  return `This service cannot read a body in ${charset?.name ?? plainTextCharset(header)}`;
}

/**
 * The bytes StringHttpMessageConverter writes a text of printable ASCII in,
 * in a charset mediaType has taken, as measured on Java (charset-snapshot.json):
 * the text's own bytes, or each character's after the bytes every write
 * starts with (a byte-order mark); undefined where the JVM has no encoder
 * for it (ISO-2022-CN reads only), which is Java's 500.
 */
export function encodeText(text: string, charset: string): Buffer | undefined {
  const found = javaCharset(charset);
  if (!found?.encode) return undefined;
  if (found.encode === 'ascii') return Buffer.from(text, 'latin1');
  const { prefix, chars } = found.encode;
  return Buffer.from(
    prefix +
      Array.from(text, (char) => {
        const bytes = chars[char.charCodeAt(0) - 0x20];
        if (bytes === undefined) throw new Error(`not printable ASCII: ${JSON.stringify(char)}`);
        return bytes;
      }).join(''),
    'hex'
  );
}

type Decoder = (body: Buffer) => string;

/** The bytes `low` gives, by their place in it: 0x20 to 0x7E, then tab, CR and LF. */
const LOW = new Map(
  [...Array.from({ length: 0x5f }, (_, i) => i + 0x20), 9, 13, 10].map((byte, at) => [byte, at])
);

/**
 * The JDK decoders this repeats exactly, by canonical name: the UTF family.
 * x-UTF-16LE-BOM reads a mark either way and is little-endian without one;
 * the UTF-32 -BOM variants read as their order does.
 */
const EXACT: Record<string, Decoder> = {
  'UTF-8': (body) => body.toString('utf8'),
  'UTF-16': (body) => utf16(body, undefined),
  'UTF-16BE': (body) => utf16(body, 'be'),
  'UTF-16LE': (body) => utf16(body, 'le'),
  'x-UTF-16LE-BOM': (body) => utf16(body, undefined, true),
  'UTF-32': (body) => utf32(body, undefined),
  'UTF-32BE': (body) => utf32(body, 'be'),
  'UTF-32LE': (body) => utf32(body, 'le'),
  'X-UTF-32BE-BOM': (body) => utf32(body, 'be'),
  'X-UTF-32LE-BOM': (body) => utf32(body, 'le'),
};

/**
 * How to read a body in a Java charset, or undefined where this cannot read
 * it as Java does, from what was measured on Java (charset-snapshot.json).
 * The UTF family by the JDK's rules (EXACT); a single-byte charset by its
 * table, exactly, and a shifting EBCDIC one the same way while no shift-out
 * byte comes; a body of printable ASCII, tab, CR and LF by what each of
 * those bytes reads as (no escape or shift in it to change a stateful
 * charset's state); and anything else in a multi-byte charset by
 * TextDecoder where it knows one of the charset's names -- the same for the
 * ids these bodies hold, but for odd bytes perhaps not. Otherwise
 * undefined: a pure double-byte code page, or bytes past ASCII in a
 * charset TextDecoder does not know.
 */
function readerFor(charset: JavaCharset, body: Buffer): Decoder | undefined {
  const exact = EXACT[charset.name];
  if (exact) return exact;
  const { table, unread = [] } = charset;
  if (table && !body.some((byte) => unread.includes(byte)))
    return (bytes) => Array.from(bytes, (byte) => table.charAt(byte)).join('');
  const { low } = charset;
  if (low && body.every((byte) => LOW.has(byte)))
    return (bytes) => Array.from(bytes, (byte) => low.charAt(LOW.get(byte) as number)).join('');
  for (const name of [charset.name, ...charset.aliases]) {
    try {
      const decoder = new TextDecoder(name);
      if (decoder.encoding === 'replacement' || decoder.encoding.startsWith('utf-16')) continue;
      return (bytes) => decoder.decode(bytes);
    } catch {
      // Not a name TextDecoder knows.
    }
  }
  return undefined;
}

/**
 * The JDK's UTF-16 decoders: with no order given, a byte-order mark decides it
 * and is dropped, and without one it is big-endian (little-endian for
 * x-UTF-16LE-BOM, `little`); with an order, a mark is a character. A reversed mark (U+FFFE) anywhere, a lone surrogate or an odd
 * last byte is U+FFFD -- one for a high surrogate and the odd byte after it.
 */
function utf16(body: Buffer, order: 'be' | 'le' | undefined, littleByDefault = false): string {
  // Every read below is inside `body`: each checks the length first.
  const byte = (at: number) => body[at] as number;
  let at = 0;
  let little = order === 'le' || littleByDefault;
  if (order === undefined && body.length >= 2) {
    if (byte(0) === 0xfe && byte(1) === 0xff) {
      at = 2;
      little = false;
    } else if (byte(0) === 0xff && byte(1) === 0xfe) {
      at = 2;
      little = true;
    }
  }
  const units: number[] = [];
  for (; at + 1 < body.length; at += 2)
    units.push(little ? byte(at) | (byte(at + 1) << 8) : (byte(at) << 8) | byte(at + 1));
  let text = '';
  for (let i = 0; i < units.length; i += 1) {
    const unit = present(units[i]);
    const next = units[i + 1];
    if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      next !== undefined &&
      next >= 0xdc00 &&
      next <= 0xdfff
    ) {
      text += String.fromCharCode(unit, next);
      i += 1;
    } else
      text +=
        (unit >= 0xd800 && unit <= 0xdfff) || unit === 0xfffe
          ? '\ufffd'
          : String.fromCharCode(unit);
  }
  // A high surrogate waiting at the end takes the odd byte with it: one U+FFFD.
  const last = units.at(-1);
  const waiting = last !== undefined && last >= 0xd800 && last <= 0xdbff;
  return at < body.length && !waiting ? `${text}\ufffd` : text;
}

/**
 * The JDK's UTF-32 decoders: a leading byte-order mark is dropped -- and,
 * with no order given, decides it (big-endian without one) -- unless it is
 * the other order's mark; a value past U+10FFFF, a surrogate, or a short last
 * group is U+FFFD.
 */
function utf32(body: Buffer, order: 'be' | 'le' | undefined): string {
  let at = 0;
  let little = order === 'le';
  if (body.length >= 4) {
    const first = body.readUInt32BE(0);
    if (first === 0xfeff && order !== 'le') {
      at = 4;
      little = false;
    } else if (first === 0xfffe0000 && order !== 'be') {
      at = 4;
      little = true;
    }
  }
  let text = '';
  for (; at + 3 < body.length; at += 4) {
    const point = little ? body.readUInt32LE(at) : body.readUInt32BE(at);
    text +=
      point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(point);
  }
  return at < body.length ? `${text}\ufffd` : text;
}

/**
 * The ids in getOrthologies' body: String.split on , ; newline or tab --
 * trailing empty strings dropped, as Java's split drops them -- each trimmed;
 * more than twenty, the first twenty collected into a HashSet, in its order.
 */
export function orthologyIds(body: string): string[] {
  const ids = plainIds(body);
  if (ids.length <= 20) return ids;
  const set = new JavaHashMap<string, boolean>();
  for (const id of ids.slice(0, 20)) set.set(id, true);
  return [...set.keys()];
}
