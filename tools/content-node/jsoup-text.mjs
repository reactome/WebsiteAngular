/**
 * Jsoup.parse(html).text(), as Jsoup 1.14.3 -- the version the Java content
 * service runs -- gives it. ControllerUtils.toTSV writes a summation's text
 * this way under /data/query/{id}/{attributeName}, and about a fifth of the
 * summations hold markup or entities: tables, line breaks, paragraphs,
 * italics, `&amp;`.
 *
 * Three steps, each Jsoup's:
 *
 *  - tokenising (Tokeniser, TokeniserState): tags, comments and character
 *    references, with Jsoup's entity rules -- a reference needs its `;`
 *    unless it is one of the 106 base entities, and `&copyright` is no
 *    reference at all (no longest-prefix match);
 *  - building the tree (HtmlTreeBuilder, HtmlTreeBuilderState), in quirks
 *    mode since a summation has no doctype: only what moves text or changes
 *    which elements are blocks is kept -- implied and closed paragraphs and
 *    list items, table cells outside a table being ignored, text inside a
 *    table but outside its cells being fostered out in front of the table;
 *  - Element.text(): whitespace runs collapsed, a space before a block or
 *    <br> and after a block followed by text, the whole trimmed.
 *
 * The tables (named entities, which tags are blocks) are Jsoup's own, read
 * from its jar into jsoup-tables.json by snapshot-jsoup/JsoupTables.java.
 *
 * Checked against Jsoup itself over every summation in the graph (21,634
 * texts) and the inputs in jsoup-text.spec.mjs, not against a reading of the
 * HTML specification: where this simplifies the tree builder, it is because no
 * summation reaches the rest. Known to differ from Jsoup, and in no summation:
 * a formatting element left open across a table's boundary
 * (`<table><b>x<tr>...z</b></table>`, `<b>1<table>2</b>3</table>`, where the
 * full adoption agency and foster parenting move text), and the obsolete
 * <frameset> and <isindex>.
 */
import { readFileSync } from 'node:fs';

let tables;
/** jsoup-tables.json, read on first use, as domain.mjs reads its snapshot. */
function TABLES() {
  tables ??= JSON.parse(readFileSync(new URL('./jsoup-tables.json', import.meta.url), 'utf8'));
  return tables;
}

const isBlock = (name) => TABLES().tags[name]?.[0] === 1;
const preservesWhitespace = (name) => TABLES().tags[name]?.[1] === 1;
const isEmptyTag = (name) => TABLES().tags[name]?.[2] === 1;

/** Windows-1252's characters for 0x80-0x9F, which Jsoup gives numeric references in that range. */
const WIN1252 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isDigit = (c) => c >= '0' && c <= '9';
// Character.isLetter and Character.isDigit, which an entity's name is read by.
const isAnyLetter = (c) => /\p{L}/u.test(c);
const isAnyDigit = (c) => /\p{Nd}/u.test(c);
const isHex = (c) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');

/**
 * A character reference starting at text[at] (just past the '&'), as
 * Tokeniser.consumeCharacterReference reads one: [the characters, where
 * reading resumes], or undefined for none -- the '&' is then itself.
 */
function characterReference(text, at) {
  if (at >= text.length || '\t\n\r\f <&'.includes(text[at])) return undefined;
  if (text[at] === '#') {
    let next = at + 1;
    const hex = text[next] === 'x' || text[next] === 'X';
    if (hex) next += 1;
    const start = next;
    while (next < text.length && (hex ? isHex(text[next]) : isDigit(text[next]))) next += 1;
    if (next === start) return undefined;
    let value = Number.parseInt(text.slice(start, next), hex ? 16 : 10);
    // Integer.valueOf: past an int is NumberFormatException, read as -1.
    if (!Number.isSafeInteger(value) || value > 0x7fffffff) value = -1;
    if (text[next] === ';') next += 1;
    if (value === -1 || (value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff)
      return ['�', next];
    if (value >= 0x80 && value < 0x80 + WIN1252.length) value = WIN1252[value - 0x80];
    return [String.fromCodePoint(value), next];
  }
  // consumeLetterThenDigitSequence: letters, then digits; never a prefix of it.
  let next = at;
  while (next < text.length && isAnyLetter(text[next])) next += 1;
  while (next < text.length && isAnyDigit(text[next])) next += 1;
  const name = text.slice(at, next);
  const entities = TABLES().entities;
  const entity = Object.hasOwn(entities, name) ? entities[name] : undefined;
  const legit = text[next] === ';';
  if (!entity || (entity[0] !== 1 && !legit)) return undefined;
  if (legit) next += 1;
  return [String.fromCodePoint(...entity.slice(1)), next];
}

/** The tokens of an HTML text: {text}, {cdata}, {start, name} and {end, name}. */
function tokens(html) {
  const out = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ text });
    text = '';
  };
  let at = 0;
  // RAWTEXT and RCDATA: after these start tags, text up to the matching end tag.
  let raw;
  while (at < html.length) {
    if (raw) {
      const close = html.toLowerCase().indexOf(`</${raw.name}`, at);
      const stop = close === -1 ? html.length : close;
      let chunk = html.slice(at, stop);
      if (raw.references) chunk = decode(chunk);
      // A script's or style's content is a DataNode, which text() leaves out.
      if (!['script', 'style'].includes(raw.name)) text += chunk;
      at = stop;
      raw = undefined;
      continue;
    }
    const c = html[at];
    if (c === '&') {
      const reference = characterReference(html, at + 1);
      if (reference) {
        text += reference[0];
        at = reference[1];
      } else {
        text += '&';
        at += 1;
      }
      continue;
    }
    if (c !== '<') {
      text += c;
      at += 1;
      continue;
    }
    const next = html[at + 1];
    if (next !== undefined && isLetter(next)) {
      const tag = readTag(html, at + 1);
      if (!tag) break; // EOF inside a tag: the tag is dropped.
      flush();
      out.push({ start: true, name: tag.name });
      if (['title', 'textarea'].includes(tag.name)) raw = { name: tag.name, references: true };
      else if (
        ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].includes(tag.name)
      )
        raw = { name: tag.name, references: false };
      else if (tag.name === 'plaintext') raw = { name: '\u0000plaintext', references: false };
      at = tag.end;
      // A newline straight after <pre>, <listing> or <textarea> is dropped.
      if (['pre', 'listing', 'textarea'].includes(tag.name) && html[at] === '\n') at += 1;
      continue;
    }
    if (next === '/') {
      const after = html[at + 2];
      if (after !== undefined && isLetter(after)) {
        const tag = readTag(html, at + 2);
        if (!tag) break;
        flush();
        out.push({ end: true, name: tag.name });
        at = tag.end;
        continue;
      }
      if (after === '>') {
        at += 3;
        continue;
      }
      if (after === undefined) {
        text += '</';
        at += 2;
        continue;
      }
      // A bogus comment, up to '>'.
      const close = html.indexOf('>', at);
      at = close === -1 ? html.length : close + 1;
      continue;
    }
    if (next === '!') {
      flush();
      if (html.startsWith('<!--', at)) {
        // <!--> and <!---> are whole comments; otherwise --> or --!> ends one.
        if (html[at + 4] === '>') at += 5;
        else if (html.startsWith('->', at + 4)) at += 6;
        else {
          const ends = [html.indexOf('-->', at + 4), html.indexOf('--!>', at + 4)].filter(
            (found) => found !== -1
          );
          const close = ends.length ? Math.min(...ends) : -1;
          at = close === -1 ? html.length : close + (html.startsWith('--!>', close) ? 4 : 3);
        }
      } else if (html.startsWith('<![CDATA[', at)) {
        // A CDataNode: kept as written, whitespace and all.
        const close = html.indexOf(']]>', at + 9);
        const stop = close === -1 ? html.length : close;
        out.push({ cdata: html.slice(at + 9, stop) });
        at = close === -1 ? html.length : close + 3;
      } else {
        const close = html.indexOf('>', at);
        at = close === -1 ? html.length : close + 1;
      }
      continue;
    }
    if (next === '?') {
      flush();
      const close = html.indexOf('>', at);
      at = close === -1 ? html.length : close + 1;
      continue;
    }
    text += '<';
    at += 1;
  }
  flush();
  return out;
}

/** Character references decoded through a whole text (RCDATA). */
function decode(text) {
  let out = '';
  let at = 0;
  while (at < text.length) {
    if (text[at] === '&') {
      const reference = characterReference(text, at + 1);
      if (reference) {
        out += reference[0];
        at = reference[1];
        continue;
      }
    }
    out += text[at];
    at += 1;
  }
  return out;
}

/**
 * A tag from its name's first character: the name lower-cased, its
 * attributes skipped (quoted values may hold '>'), and where it ends -- a
 * self-closing '/' changes nothing the text depends on; or
 * undefined when the text ends first.
 */
function readTag(html, at) {
  let end = at;
  while (end < html.length && !'\t\n\f\r />'.includes(html[end])) {
    // A '<' in a tag's name ends the tag there, and starts the next.
    if (html[end] === '<') return { name: html.slice(at, end).toLowerCase(), end };
    end += 1;
  }
  const name = html.slice(at, end).toLowerCase();
  let quote;
  while (end < html.length) {
    const c = html[end];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      // Only an attribute's value opens a quote: after '=' and any spaces.
      let back = end - 1;
      while (back > at && '\t\n\f\r '.includes(html[back])) back -= 1;
      if (html[back] === '=') quote = c;
    } else if (c === '>') {
      return { name, end: end + 1 };
    }
    end += 1;
  }
  return undefined;
}

class Node {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.children = [];
  }
}

const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dir',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'menu',
  'nav',
  'ol',
  'p',
  'section',
  'summary',
  'ul',
  'main',
  'pre',
  'listing',
  'form',
  'plaintext',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'dd',
  'dt',
]);
const IGNORED_IN_BODY = new Set([
  'caption',
  'col',
  'colgroup',
  'frame',
  'head',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
]);
const SPECIAL = new Set([
  'address',
  'applet',
  'area',
  'article',
  'aside',
  'base',
  'basefont',
  'bgsound',
  'blockquote',
  'body',
  'br',
  'button',
  'caption',
  'center',
  'col',
  'colgroup',
  'command',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'input',
  'isindex',
  'li',
  'link',
  'listing',
  'marquee',
  'menu',
  'meta',
  'nav',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'ol',
  'p',
  'param',
  'plaintext',
  'pre',
  'script',
  'section',
  'select',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
  'wbr',
  'xmp',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const FORMATTING = new Set([
  'a',
  'b',
  'big',
  'code',
  'em',
  'font',
  'i',
  'nobr',
  's',
  'small',
  'strike',
  'strong',
  'tt',
  'u',
]);
const TABLE_SECTIONS = new Set(['tbody', 'thead', 'tfoot']);
const SCOPE_LIMITS = new Set([
  'applet',
  'caption',
  'html',
  'marquee',
  'object',
  'table',
  'td',
  'th',
  'math',
  'svg',
]);

/** A simplified HtmlTreeBuilder: the document's tree, as Jsoup builds it. */
function build(html) {
  const documentNode = new Node('#document');
  const htmlNode = new Node('html', documentNode);
  const head = new Node('head', htmlNode);
  const body = new Node('body', htmlNode);
  documentNode.children.push(htmlNode);
  htmlNode.children.push(head, body);
  const stack = [htmlNode, body];
  const current = () => stack[stack.length - 1];
  const has = (name, limits = SCOPE_LIMITS) => {
    for (let at = stack.length - 1; at >= 0; at -= 1) {
      if (stack[at].name === name) return true;
      if (limits.has(stack[at].name)) return false;
    }
    return false;
  };
  const buttonScope = new Set([...SCOPE_LIMITS, 'button']);
  const listScope = new Set([...SCOPE_LIMITS, 'ol', 'ul']);
  const tableScope = new Set(['html', 'table']);
  const popUntil = (name) => {
    while (stack.length > 2) {
      const popped = stack.pop();
      if (popped.name === name) return;
    }
  };
  const closeP = () => {
    if (has('p', buttonScope)) popUntil('p');
  };
  const inTable = () => {
    for (let at = stack.length - 1; at >= 0; at -= 1) {
      const name = stack[at].name;
      if (name === 'td' || name === 'th' || name === 'caption') return false;
      if (name === 'table') return true;
    }
    return false;
  };
  const tableNode = () => {
    for (let at = stack.length - 1; at >= 0; at -= 1)
      if (stack[at].name === 'table') return stack[at];
    return undefined;
  };
  // Foster parenting: what may not sit in a table goes before it.
  const append = (node) => {
    const parent = current();
    if (inTable() && ['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(parent.name)) {
      const table = tableNode();
      const host = table.parent;
      host.children.splice(host.children.indexOf(table), 0, node);
      node.parent = host;
      return;
    }
    node.parent = parent;
    parent.children.push(node);
  };
  const appendText = (text) => {
    const parent = current();
    let host = parent;
    let before;
    if (inTable() && ['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(parent.name)) {
      if (/^[\t\n\f\r ]*$/.test(text)) {
        host = parent;
      } else {
        const table = tableNode();
        host = table.parent;
        before = table;
      }
    }
    const siblings = host.children;
    const at = before ? siblings.indexOf(before) : siblings.length;
    const previous = siblings[at - 1];
    if (previous && previous.text !== undefined && !previous.cdata) previous.text += text;
    else siblings.splice(at, 0, { text, parent: host });
  };
  const insert = (name, push = true) => {
    const node = new Node(name, current());
    append(node);
    if (push) stack.push(node);
    return node;
  };
  // The list of active formatting elements: a formatting element a block's
  // end closed is opened again before the next text or inline element --
  // <p><i>a</p>b</i> is "ab", the b inside a new <i>. MARKER scopes a cell.
  const MARKER = {};
  const active = [];
  const reconstruct = () => {
    if (!active.length) return;
    let at = active.length - 1;
    const open = (entry) => entry === MARKER || stack.includes(entry.node);
    if (open(active[at])) return;
    while (at > 0 && !open(active[at - 1])) at -= 1;
    for (; at < active.length; at += 1) active[at].node = insert(active[at].name);
  };
  const lastActive = (name) => {
    for (let at = active.length - 1; at >= 0 && active[at] !== MARKER; at -= 1)
      if (active[at].name === name) return at;
    return -1;
  };
  const clearToMarker = () => {
    while (active.length && active.pop() !== MARKER);
  };
  // The adoption agency, as far as text needs it: the formatting element
  // closed with everything open inside it, and taken off the list.
  const closeFormatting = (name) => {
    const at = lastActive(name);
    if (at === -1) return false;
    const { node } = active[at];
    active.splice(at, 1);
    const position = stack.indexOf(node);
    if (position !== -1) stack.length = position;
    return true;
  };
  const inFosterContext = () =>
    inTable() && ['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(current().name);

  for (const token of tokens(html)) {
    if (token.text !== undefined) {
      if (!inFosterContext()) reconstruct();
      appendText(token.text);
      continue;
    }
    if (token.cdata !== undefined) {
      const node = { text: token.cdata, cdata: true, parent: current() };
      current().children.push(node);
      continue;
    }
    const { name } = token;
    if (token.start) {
      if (['html', 'body'].includes(name)) continue;
      if (
        inTable() &&
        ![
          'td',
          'th',
          'tr',
          'tbody',
          'thead',
          'tfoot',
          'caption',
          'col',
          'colgroup',
          'table',
        ].includes(name)
      ) {
        // In a table but not in a cell: fostered out, as any other start tag.
        if (isEmptyTag(name)) insert(name, false);
        else insert(name);
        continue;
      }
      if (
        inTable() ||
        (has('table', tableScope) &&
          ['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup'].includes(
            name
          ) &&
          tableNode())
      ) {
        if (name === 'table') {
          // A table start tag in a table closes it, then opens another.
          popUntil('table');
          insert('table');
          continue;
        }
        if (TABLE_SECTIONS.has(name)) {
          while (!['table'].includes(current().name) && stack.length > 2) stack.pop();
          insert(name);
          continue;
        }
        if (name === 'tr') {
          while (!['table', 'tbody', 'thead', 'tfoot'].includes(current().name) && stack.length > 2)
            stack.pop();
          if (current().name === 'table') insert('tbody');
          insert('tr');
          continue;
        }
        if (name === 'td' || name === 'th') {
          while (
            !['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(current().name) &&
            stack.length > 2
          )
            stack.pop();
          if (current().name === 'table') insert('tbody');
          if (current().name !== 'tr') insert('tr');
          insert(name);
          active.push(MARKER);
          continue;
        }
        if (name === 'caption') {
          while (current().name !== 'table' && stack.length > 2) stack.pop();
          insert('caption');
          active.push(MARKER);
          continue;
        }
        if (name === 'colgroup' || name === 'col') {
          while (current().name !== 'table' && stack.length > 2) stack.pop();
          if (name === 'col') {
            insert('colgroup');
            insert('col', false);
          } else insert('colgroup');
          continue;
        }
      }
      if (IGNORED_IN_BODY.has(name)) continue;
      if (name === 'table') {
        // Quirks mode: a table does not close an open paragraph.
        insert('table');
        continue;
      }
      if (name === 'li' || name === 'dd' || name === 'dt') {
        const kin = name === 'li' ? ['li'] : ['dd', 'dt'];
        for (let at = stack.length - 1; at >= 0; at -= 1) {
          const open = stack[at].name;
          if (kin.includes(open)) {
            popUntil(open);
            break;
          }
          if (SPECIAL.has(open) && !['address', 'div', 'p'].includes(open)) break;
        }
        closeP();
        insert(name);
        continue;
      }
      if (HEADINGS.has(name)) {
        closeP();
        if (HEADINGS.has(current().name)) stack.pop();
        insert(name);
        continue;
      }
      if (CLOSES_P.has(name)) {
        closeP();
        if (isEmptyTag(name)) insert(name, false);
        else insert(name);
        continue;
      }
      if (FORMATTING.has(name)) {
        // A second <a> first closes the one still open.
        if (name === 'a') closeFormatting('a');
        reconstruct();
        active.push({ name, node: insert(name) });
        continue;
      }
      reconstruct();
      if (isEmptyTag(name)) {
        insert(name, false);
        continue;
      }
      insert(name);
      continue;
    }
    // End tags.
    if (name === 'br') {
      insert('br', false);
      continue;
    }
    if (name === 'p') {
      if (!has('p', buttonScope)) insert('p', false);
      else popUntil('p');
      continue;
    }
    if (name === 'body' || name === 'html') continue;
    if (
      inTable() ||
      ['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'table', 'caption'].includes(name)
    ) {
      if (
        ['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'table', 'caption', 'colgroup'].includes(name)
      ) {
        if (has(name, name === 'table' ? tableScope : new Set(['html', 'table']))) {
          popUntil(name);
          if (['td', 'th', 'caption'].includes(name)) clearToMarker();
        }
        continue;
      }
    }
    if (name === 'li') {
      if (has('li', listScope)) popUntil('li');
      continue;
    }
    // A block's end tag closes what it implies (li, p, dd, dt...) and itself.
    if (CLOSES_P.has(name) && !HEADINGS.has(name)) {
      if (has(name)) popUntil(name);
      continue;
    }
    if (HEADINGS.has(name)) {
      for (let at = stack.length - 1; at >= 2; at -= 1)
        if (HEADINGS.has(stack[at].name)) {
          stack.length = at;
          break;
        }
      continue;
    }
    if (FORMATTING.has(name) && closeFormatting(name)) continue;
    // Any other end tag: the nearest open element of that name, unless a
    // special element stands in the way.
    for (let at = stack.length - 1; at >= 2; at -= 1) {
      const open = stack[at].name;
      if (open === name) {
        stack.length = at;
        break;
      }
      if (SPECIAL.has(open)) break;
    }
  }
  return documentNode;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\f', '\r', ' ']);
const INVISIBLE = new Set(['​', '­']);

/** Element.text() over a built tree. */
function text(root) {
  let accum = '';
  const lastIsSpace = () => accum.length > 0 && accum[accum.length - 1] === ' ';
  const preserved = (node) => {
    let at = node;
    for (let depth = 0; at && depth < 6; depth += 1) {
      if (at.name && preservesWhitespace(at.name)) return true;
      at = at.parent;
    }
    return false;
  };
  const appendText = (node) => {
    if (node.cdata || preserved(node.parent)) {
      accum += node.text;
      return;
    }
    let lastWasWhite = false;
    let reachedNonWhite = false;
    const stripLeading = lastIsSpace();
    for (const c of node.text) {
      if (WHITESPACE.has(c)) {
        if ((stripLeading && !reachedNonWhite) || lastWasWhite) continue;
        accum += ' ';
        lastWasWhite = true;
      } else if (!INVISIBLE.has(c)) {
        accum += c;
        lastWasWhite = false;
        reachedNonWhite = true;
      }
    }
  };
  const visit = (node) => {
    if (node.text !== undefined) {
      appendText(node);
      return;
    }
    if (
      node.name !== '#document' &&
      accum.length > 0 &&
      (isBlock(node.name) || node.name === 'br') &&
      !lastIsSpace()
    )
      accum += ' ';
    for (const child of node.children) visit(child);
    if (node.name !== '#document' && isBlock(node.name)) {
      const siblings = node.parent?.children ?? [];
      const next = siblings[siblings.indexOf(node) + 1];
      if (next && next.text !== undefined && !lastIsSpace()) accum += ' ';
    }
  };
  visit(root);
  return javaTrim(accum);
}

/** String.trim: every character at or below U+0020 off both ends. */
function javaTrim(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

/** Jsoup.parse(html).text(). */
export function jsoupText(html) {
  return text(build(html));
}
