/**
 * A text/plain request body as Spring reads it (spec 014, research R1 layer
 * 2): the charset from the Content-Type, decoded by Java's own decoders, and
 * the ids in it split as the controllers split them. Moved unchanged from
 * service.ts.
 */
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

function knownCharset(name: string) {
  return decoderFor(name.toLowerCase()) !== undefined;
}

/**
 * A text/plain body as StringHttpMessageConverter reads it: in the header's
 * charset, else UTF-8 -- Spring Boot gives the converter UTF-8 as its default,
 * not the class's own ISO-8859-1 (measured: Java reads C3 A9 as "é") -- a
 * malformed sequence read as U+FFFD. The charset is the parameter named
 * exactly `charset`, unquoted, as Spring finds it: `Charset=` names none.
 */
export function plainText(body: Buffer, header?: string) {
  const media = header ? mediaType(header) : undefined;
  const own =
    typeof media === 'object'
      ? media.parameters.find(([name]) => name === 'charset')?.[1]
      : undefined;
  const charset = own === undefined ? 'utf-8' : unquote(own).toLowerCase();
  return (decoderFor(charset) ?? UTF_8)(body);
}

/**
 * A text in a charset Java writes it in, by a name mediaType has taken:
 * the UTF-16 and UTF-32 families as the JDK's encoders write them (UTF-16
 * with a big-endian byte-order mark, UTF-32 without one), Latin-1 and ASCII with '?' for what they cannot hold, and
 * any other as UTF-8 -- the same bytes, for ASCII text, in every
 * ASCII-compatible charset, which is what the content service writes this
 * way.
 */
export function encodeText(text: string, charset: string): Buffer {
  const name = charset.toLowerCase();
  const units = (little: boolean, mark: boolean) => {
    const out = Buffer.alloc((text.length + (mark ? 1 : 0)) * 2);
    let at = 0;
    for (const unit of [
      ...(mark ? [0xfeff] : []),
      ...Array.from(text, (_, i) => text.charCodeAt(i)),
    ]) {
      if (little) out.writeUInt16LE(unit, at);
      else out.writeUInt16BE(unit, at);
      at += 2;
    }
    return out;
  };
  const points = (little: boolean) => {
    const values = Array.from(text, (char) => char.codePointAt(0) as number);
    const out = Buffer.alloc(values.length * 4);
    values.forEach((value, i) =>
      little ? out.writeUInt32LE(value, i * 4) : out.writeUInt32BE(value, i * 4)
    );
    return out;
  };
  if (['utf-16', 'utf_16', 'utf16', 'unicode'].includes(name)) return units(false, true);
  if (
    ['utf-16be', 'utf_16be', 'x-utf-16be', 'iso-10646-ucs-2', 'unicodebigunmarked'].includes(name)
  )
    return units(false, false);
  if (['utf-16le', 'utf_16le', 'x-utf-16le', 'unicodelittleunmarked'].includes(name))
    return units(true, false);
  if (['utf-32', 'utf_32', 'utf32', 'utf-32be', 'utf_32be', 'x-utf-32be'].includes(name))
    return points(false);
  if (['utf-32le', 'utf_32le', 'x-utf-32le'].includes(name)) return points(true);
  const latin1 = JAVA_CHARSET_NAMES[0]?.[0].split(' ') ?? [];
  const ascii = JAVA_CHARSET_NAMES[1]?.[0].split(' ') ?? [];
  if (latin1.includes(name) || ascii.includes(name)) {
    const limit = latin1.includes(name) ? 0xff : 0x7f;
    return Buffer.from(
      Array.from(text, (char) => ((char.codePointAt(0) as number) > limit ? '?' : char)).join(''),
      'latin1'
    );
  }
  return Buffer.from(text, 'utf8');
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
