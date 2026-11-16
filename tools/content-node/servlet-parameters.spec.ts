// @vitest-environment node
//
// servletParameters and servletParameter (spring.ts) read a query or a form
// body in one linear pass. The decoder they replaced built a Buffer for every
// character and was run once per name: a 1MB body took seconds. The old one
// is kept here, as it was, and the new must give what it gave, on the
// examples of service.spec.ts and on random text full of escapes, malformed
// ones, '+', '=', '&', multi-byte characters and lone surrogates.
import { describe, expect, it } from 'vitest';
import { javaUtf8 } from './java-text.ts';
import { servletParameter, servletParameters } from './spring.ts';

/** The decoder as it was before the one pass, kept to compare with. */
function oldDecode(text: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
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

/** servletParameter as it was. */
function oldParameter(query: string, name: string): string[] {
  const values: string[] = [];
  for (const pair of String(query).split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    const key = oldDecode(at === -1 ? pair : pair.slice(0, at));
    const value = oldDecode(at === -1 ? '' : pair.slice(at + 1));
    if (key === null || value === null || key === '') continue;
    if (key === name) values.push(value);
  }
  return values;
}

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'a',
  'b',
  'name',
  '=',
  '&',
  '&&',
  '+',
  '%',
  '%2',
  '%zz',
  '%g0',
  '%0G',
  '%41',
  '%2B',
  '%25',
  '%26',
  '%3D',
  '%C3',
  '%A9',
  '%c3%a9',
  '%E2',
  '%82',
  '%AC',
  '%ED%A0%80',
  '%F0%9F%98%80',
  '%F4%90%80%80',
  '%FF',
  '%80',
  '%00',
  '\u0080',
  '\u00e9',
  '\u07ff',
  '\u20ac',
  '\u0800',
  '\ud7ff',
  '\ue000',
  '\uffff',
  '\ud83d\ude00',
  '\ud800',
  '\udc00',
  ' ',
  ';',
  '\u0000',
];

describe('servletParameters, one linear pass', () => {
  it('reads every name as the old decoder did, on 5,000 random queries', () => {
    const next = random(20261106);
    const names = ['a', 'b', 'name', 'a b', '\u00e9', '=', '+', '\ufffd', '&'];
    for (let run = 0; run < 5_000; run += 1) {
      const length = Math.floor(next() * 24);
      let query = '';
      for (let i = 0; i < length; i += 1) query += PIECES[Math.floor(next() * PIECES.length)] ?? '';
      const all = servletParameters(query);
      for (const name of names)
        expect([query, name, servletParameter(query, name)]).toEqual([
          query,
          name,
          oldParameter(query, name),
        ]);
      // And every name the map holds, not only the ones asked for.
      for (const [name, values] of all)
        expect([query, name, values]).toEqual([query, name, oldParameter(query, name)]);
    }
  });

  it('reads 1MB in well under a second, and once for every name', () => {
    const body = `message=${'a%20b+c%C3%A9'.repeat(80_000)}&subject=s`;
    const started = performance.now();
    const all = servletParameters(body);
    expect(performance.now() - started).toBeLessThan(500);
    expect(all.get('subject')).toEqual(['s']);
    expect(all.get('message')?.[0]?.length).toBe(80_000 * 6);
  });
});
