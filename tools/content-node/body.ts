/**
 * A text/plain request body as Spring reads it (spec 014, research R1 layer
 * 2): the charset from the Content-Type, decoded by Java's own decoders, and
 * the ids in it split as the controllers split them. Moved unchanged from
 * service.ts.
 */
import { javaTrim, present } from './java-text.ts';
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
 * Whether Spring takes a Content-Type for `consumes = "text/plain"`: undefined
 * if so, else the 415's message. It parses the header as MimeTypeUtils does
 * -- the type and subtype lower-cased, parameters as given, a charset Java
 * must know -- and only text/plain is compatible: `text/*` is not.
 */
export function plainTextProblem(header: string | undefined): string | undefined {
  if (!header) return "Content type '' not supported";
  const invalid = (why: string) => `Invalid mime type "${header}": ${why}`;
  const [first = '', ...rest] = header.split(';');
  const full = first.trim() === '*' ? '*/*' : first.trim();
  const slash = full.indexOf('/');
  if (slash === -1) return invalid("does not contain '/'");
  if (slash === full.length - 1) return invalid("does not contain subtype after '/'");
  const type = full.slice(0, slash).toLowerCase();
  const subtype = full.slice(slash + 1).toLowerCase();
  if (type === '*' && subtype !== '*')
    return invalid("wildcard type is legal only in '*/*' (all mime types)");
  const parameters: string[] = [];
  for (const parameter of rest) {
    const at = parameter.indexOf('=');
    if (at === -1) continue;
    const name = parameter.slice(0, at).trim();
    const value = parameter.slice(at + 1).trim();
    if (name.toLowerCase() === 'charset' && !knownCharset(value))
      return invalid(`unsupported charset '${value.replace(/^"(.*)"$/, '$1')}'`);
    parameters.push(`;${name}=${value}`);
  }
  if (type === 'text' && subtype === 'plain') return undefined;
  return `Content type '${type}/${subtype}${parameters.join('')}' not supported`;
}

function knownCharset(value: string) {
  return decoderFor(value.replace(/^"(.*)"$/, '$1').toLowerCase()) !== undefined;
}

/**
 * A text/plain body as StringHttpMessageConverter reads it: in the header's
 * charset, else UTF-8 -- Spring Boot gives the converter UTF-8 as its default,
 * not the class's own ISO-8859-1 (measured: Java reads C3 A9 as "é") -- a
 * malformed sequence read as U+FFFD.
 */
export function plainText(body: Buffer, header?: string) {
  const charset = /;\s*charset\s*=\s*"?([^";]+)"?/i
    .exec(header ?? '')?.[1]
    ?.trim()
    .toLowerCase();
  return (decoderFor(charset ?? 'utf-8') ?? UTF_8)(body);
}

type Decoder = (body: Buffer) => string;

const UTF_8: Decoder = (body) => body.toString('utf8');

/** Java's names for the charsets decoded here as Java decodes them. */
const JAVA_CHARSET_NAMES: [names: string, decode: Decoder][] = [
  [
    'iso-8859-1 iso8859_1 iso_8859_1 iso_8859-1 iso8859-1 8859_1 latin1 l1 ibm819 ibm-819 cp819 819 csisolatin1 iso-ir-100 iso_8859-1:1987',
    (body) => body.toString('latin1'),
  ],
  [
    'us-ascii ascii us iso646-us 646 ascii7 default csascii cp367 ibm367 iso-ir-6 ansi_x3.4-1968 ansi_x3.4-1986 iso_646.irv:1983 iso_646.irv:1991',
    (body) =>
      Array.from(body, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : '\ufffd')).join(''),
  ],
  ['utf-8 utf8 unicode-1-1-utf-8', UTF_8],
  ['utf-16 utf_16 utf16 unicode', (body) => utf16(body, undefined)],
  ['utf-16be utf_16be x-utf-16be iso-10646-ucs-2 unicodebigunmarked', (body) => utf16(body, 'be')],
  ['utf-16le utf_16le x-utf-16le unicodelittleunmarked', (body) => utf16(body, 'le')],
  ['utf-32 utf_32 utf32', (body) => utf32(body, undefined)],
  ['utf-32be utf_32be x-utf-32be', (body) => utf32(body, 'be')],
  ['utf-32le utf_32le x-utf-32le', (body) => utf32(body, 'le')],
];

const JAVA_DECODERS = new Map(
  JAVA_CHARSET_NAMES.flatMap(([names, decode]) =>
    names.split(' ').map((name): [string, Decoder] => [name, decode])
  )
);

/**
 * How to read a body in a charset named in a Content-Type, lower-cased, or
 * undefined for one this cannot read -- Spring's 415. Latin-1, ASCII and the
 * UTF family are read as the JDK reads them (orthology.spec.ts holds the
 * JDK's answers); any other charset by TextDecoder when it knows the name,
 * which for a body of stable ids reads the same. A charset only Java knows
 * (an EBCDIC code page) is refused here and read by Java.
 */
function decoderFor(charset: string): Decoder | undefined {
  if (JAVA_DECODERS.has(charset)) return JAVA_DECODERS.get(charset);
  try {
    const decoder = new TextDecoder(charset);
    return (body) => decoder.decode(body);
  } catch {
    return undefined;
  }
}

/**
 * The JDK's UTF-16 decoders: with no order given, a byte-order mark decides it
 * and is dropped, and without one it is big-endian; with an order, a mark is
 * a character. A reversed mark (U+FFFE) anywhere, a lone surrogate or an odd
 * last byte is U+FFFD -- one for a high surrogate and the odd byte after it.
 */
function utf16(body: Buffer, order: 'be' | 'le' | undefined): string {
  // Every read below is inside `body`: each checks the length first.
  const byte = (at: number) => body[at] as number;
  let at = 0;
  let little = order === 'le';
  if (order === undefined && body.length >= 2) {
    if (byte(0) === 0xfe && byte(1) === 0xff) at = 2;
    else if (byte(0) === 0xff && byte(1) === 0xfe) {
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
