// @vitest-environment node
//
// Doubles as JDK 11's Double.toString writes them, which is how Jackson
// writes every Double in ContentService's answers. JDK 11 is not always the
// shortest form; the fixture is JDK 11's own text, run on the JDK itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { javaDouble } from './domain.ts';
import { jdk11DoubleText } from './java-double.ts';

/** The double with these IEEE 754 bits, given in hex. */
function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

interface Row {
  readonly hex: string;
  readonly text: string;
  readonly nonShortest: boolean;
}

const ROWS: Row[] = readFileSync(new URL('fixtures/java-double.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => {
    const [hex = '', text = '', flag = ''] = line.split(' ');
    if (!/^[0-9a-f]{16}$/.test(hex) || !/^[01]$/.test(flag) || text === '') {
      throw new Error(`java-double fixture: cannot read ${JSON.stringify(line)}`);
    }
    return { hex, text, nonShortest: flag === '1' };
  });

describe('javaDouble, as JDK 11 writes a double', () => {
  it.each([
    [2 ** -44, '5.6843418860808015E-14'],
    [2 ** -45, '2.8421709430404007E-14'],
    [2 ** -24, '5.9604644775390625E-8'],
    [Number.MIN_VALUE, '4.9E-324'],
    [2 ** 55, '3.6028797018963968E16'],
  ])('writes %d as JDK 11 does, not in the shortest form', (value, text) => {
    expect(javaDouble(value)).toBe(text);
    expect(javaDouble(-value)).toBe(`-${text}`);
  });

  it.each([
    [0.1 + 0.2, '0.30000000000000004'],
    [1234.5678, '1234.5678'],
    [228.5 - 1 / 3, '228.16666666666666'],
    [0.001, '0.001'],
    [0.0009999999999999998, '9.999999999999998E-4'],
    [9999999.999999998, '9999999.999999998'],
    [1e7, '1.0E7'],
    [Number.MAX_VALUE, '1.7976931348623157E308'],
  ])('writes %d as JDK 11 does', (value, text) => expect(javaDouble(value)).toBe(text));

  it('writes every finite double of the fixture as JDK 11 does', () => {
    const wrong = ROWS.flatMap(({ hex, text }) => {
      const value = fromBits(hex);
      if (!Number.isFinite(value)) return [];
      const written = javaDouble(value);
      return written === text ? [] : [`${hex}: ${written}, JDK 11 ${text}`];
    });
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(wrong).toHaveLength(0);
  });

  it('writes NaN and the infinities as Java does, and Jackson quotes them', () => {
    const special = ROWS.filter(({ hex }) => !Number.isFinite(fromBits(hex)));
    expect(special.map(({ text }) => text)).toEqual(
      expect.arrayContaining(['NaN', 'Infinity', '-Infinity'])
    );
    for (const { hex, text } of special) {
      expect(jdk11DoubleText(fromBits(hex))).toBe(text);
      expect(javaDouble(fromBits(hex))).toBe(JSON.stringify(text));
    }
  });

  it('holds the cases it is for: thousands, over a thousand not the shortest', () => {
    expect(ROWS.length).toBeGreaterThan(3000);
    expect(ROWS.filter((row) => row.nonShortest).length).toBeGreaterThan(1000);
  });
});
