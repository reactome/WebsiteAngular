/**
 * The reaction layout's answer compared as text (research D21, D22): what
 * the canonical form cannot see -- number formatting, whitespace, field order
 * and what is left out -- compared on the raw text.
 *
 * Node's answer is made from the first glyph id Java's shows, so once the
 * canonical forms, the ids and the orders agree, the two texts must be the
 * same, character for character, but for three declared differences:
 * - the order of the two top keys, which a seed Java picks at start sets
 *   (D22): node's members are put in Java's order before comparing, once
 *   node's own text is shown to be nothing but `{`, its members and `,`
 *   between them, and `}`, no key twice;
 * - the order of `speciesID` and `entityFunctionalStatus` in each of the
 *   graph's events (`.graph.edges[n]`), which follows the JVM's order of the
 *   class's methods (D22): Java's are put in node's order, the deployed one;
 * - numbers within a billionth of their size, or of 1 below 1 (D22's sin and
 *   cos), where node's number must still be written as Java writes a double.
 *   Two numbers of the same value written differently (1 and 1.0, 1.0E-4 and
 *   0.0001) are a difference.
 * Anything else -- a space, a key, a string, a number further apart -- is one.
 */
import { javaDouble } from '../domain.ts';
import { sameWithin } from './compare-json.ts';

interface Token {
  kind: 'string' | 'number' | 'other';
  text: string;
  /** Where in the text it starts. */
  at: number;
  /** Where in the JSON it is: keys and indices only, never a value. */
  path: string;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** The text as tokens: strings and numbers whole, every other character alone. */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  // Each open container: its path, and the key or index reached in it.
  const open: { path: string; array: boolean; key: string; index: number }[] = [];
  let expectKey = false;
  const here = () => {
    const top = open.at(-1);
    if (!top) return '';
    return top.array ? `${top.path}[${top.index}]` : `${top.path}.${top.key}`;
  };
  for (let at = 0; at < text.length;) {
    const c = text[at] as string;
    if (c === '"') {
      let end = at + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const literal = text.slice(at, end + 1);
      const top = open.at(-1);
      if (expectKey && top && !top.array) {
        top.key = JSON.parse(literal) as string;
        expectKey = false;
      }
      out.push({ kind: 'string', text: literal, at, path: here() });
      at = end + 1;
      continue;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(text);
    if (number) {
      out.push({ kind: 'number', text: number[0], at, path: here() });
      at += number[0].length;
      continue;
    }
    if (c === '{' || c === '[') {
      out.push({ kind: 'other', text: c, at, path: here() });
      open.push({ path: here(), array: c === '[', key: '', index: 0 });
      expectKey = c === '{';
    } else if (c === '}' || c === ']') {
      open.pop();
      out.push({ kind: 'other', text: c, at, path: here() });
    } else {
      if (c === ',') {
        const top = open.at(-1);
        if (top?.array) top.index += 1;
        else expectKey = true;
      }
      out.push({ kind: 'other', text: c, at, path: here() });
    }
    at += 1;
  }
  return out;
}

/** The top object's members, each key with its value's text, in order. */
export function topMembers(text: string): [string, string][] {
  const all = tokens(text);
  const members: [string, string][] = [];
  let depth = 0;
  let key: string | undefined;
  let start = 0;
  for (const [n, token] of all.entries()) {
    if (token.kind === 'other' && (token.text === '{' || token.text === '[')) depth += 1;
    if (token.kind === 'other' && (token.text === '}' || token.text === ']')) depth -= 1;
    if (depth !== 1 && !(depth === 0 && token.text === '}')) continue;
    if (token.kind === 'string' && key === undefined && all[n + 1]?.text === ':') {
      key = JSON.parse(token.text) as string;
      start = (all[n + 2]?.at ?? text.length) as number;
    } else if (key !== undefined && (token.text === ',' || (depth === 0 && token.text === '}'))) {
      members.push([key, text.slice(start, token.at)]);
      key = undefined;
    }
  }
  return members;
}

/** Whether two number tokens agree: the same text, or D22's difference written as Java would. */
function sameNumber(java: string, node: string): boolean {
  if (java === node) return true;
  const [a, b] = [Number(java), Number(node)];
  // The same value written two ways is a formatting difference.
  if (a === b) return false;
  // A double written in Java's form, within the declared tolerance.
  const double = /[.eE]/.test(java);
  return double && javaDouble(b) === node && sameWithin(a, b);
}

/**
 * Where node's answer text first differs from Java's, beyond the declared
 * differences; undefined when it does not. Says where, never what: a path,
 * and two numbers when it is numbers that differ.
 */
export function rawDifference(answered: string, node: string): string | undefined {
  // A graph event's two getter-only fields, in node's order; only there
  // (D22). A string's quotes are escaped, so none is matched here.
  const keyPaths = new Map(
    tokens(answered)
      .filter((token) => token.kind === 'string')
      .map((token) => [token.at, token.path])
  );
  const java = answered.replace(
    /"speciesID":(-?\d+),"entityFunctionalStatus":(\[[-\d,]*\])/g,
    (pair, species: string, statuses: string, at: number) =>
      /^\.graph\.edges\[\d+\]\.speciesID$/.test(keyPaths.get(at) ?? '')
        ? `"entityFunctionalStatus":${statuses},"speciesID":${species}`
        : pair
  );
  // Node's members in Java's order: the top keys' order is Java's seed's.
  const javaKeys = topMembers(java).map(([key]) => key);
  const members = topMembers(node);
  const nodeMembers = new Map(members);
  const nodeKeys = [...nodeMembers.keys()];
  if (javaKeys.join() !== nodeKeys.join()) {
    // Rebuilt from its members, node's text loses whatever lies between
    // them: so it must have nothing else -- no byte before `{` or after `}`,
    // none after `{` or a top `,` -- and no key twice, which a map hides.
    if (nodeKeys.length !== members.length) return ".: node's text repeats a top key";
    const framed = `{${members.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`;
    if (framed !== node) {
      let at = 0;
      while (at < node.length && node[at] === framed[at]) at += 1;
      return `.: node's text differs at character ${at}`;
    }
  }
  const reordered =
    javaKeys.length === nodeKeys.length &&
    javaKeys.join() !== nodeKeys.join() &&
    javaKeys.every((key) => nodeMembers.has(key))
      ? `{${javaKeys.map((key) => `${JSON.stringify(key)}:${nodeMembers.get(key)}`).join(',')}}`
      : node;
  const [left, right] = [tokens(java), tokens(reordered)];
  for (let n = 0; n < Math.max(left.length, right.length); n += 1) {
    const [j, o] = [left[n], right[n]];
    if (!j || !o) return `${(j ?? o)?.path || '.'}: ${j ? 'node' : 'java'}'s text ends first`;
    if (j.kind === 'number' && o.kind === 'number') {
      if (!sameNumber(j.text, o.text)) return `${j.path} (java ${j.text}, node ${o.text})`;
    } else if (j.kind !== o.kind || j.text !== o.text) {
      return `${j.path || '.'}: text differs at character ${j.at}`;
    }
  }
  return undefined;
}
