// @vitest-environment node
//
// The compile helper names where each problem is, by JSON path: a wrong-kind
// message from the compiler does not, and an answer can be a megabyte.
import path from 'node:path';
import { describe as group, expect, it } from 'vitest';
import { compileAnswers, describe } from './compile.ts';

const HEADER = `import type { Thing } from ${JSON.stringify(path.join(import.meta.dirname, 'fixtures/thing.model'))};`;
const check = (type: string, value: unknown, header = HEADER) =>
  compileAnswers(
    [{ key: 'k', route: 'GET /thing/{id}', source: 'fixture', type, body: JSON.stringify(value) }],
    header
  ).map(describe);

group('compileAnswers', () => {
  it('passes an answer that fits its type', () => {
    expect(
      check('Thing[]', [{ id: 1, name: 'a', tags: ['x'], child: { id: 2, name: 'b' } }])
    ).toEqual([]);
  }, 60_000);

  it('names a missing field by the path of the object that lacks it', () => {
    const problems = check('Thing[]', [
      { id: 1, name: 'a' },
      { id: 2, name: 'b', child: { id: 3 } },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^GET \/thing\/\{id\} \[fixture\]: \$\[1\]\.child: .*'name' is missing/
    );
  }, 60_000);

  it('names an undeclared field by its own path', () => {
    const problems = check('Thing', { id: 1, name: 'a', child: { id: 2, name: 'b', extra: 1 } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/: \$\.child\.extra: .*extra\W{0,3} does not exist/);
  }, 60_000);

  it('names a value of the wrong kind by its path, which the message alone does not', () => {
    const problems = check('Thing', { id: 1, name: 'a', tags: ['x', 7], 'odd key': 'no' });
    expect(problems).toHaveLength(2);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /: \$\["odd key"\]: Type 'string' is not assignable to type 'boolean'/
        ),
        expect.stringMatching(/: \$\.tags\[1\]: Type 'number' is not assignable to type 'string'/),
      ])
    );
  }, 60_000);

  // The compiler names only the first extra field of an object, and an extra
  // field hides a missing one: counted that way, a type could fit worse and
  // the count stay the same (review of #542).
  it('names every extra field of an object, not only the first', () => {
    const problems = check('Thing', { id: 1, name: 'a', x: 1, y: 2 });
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/\$\.x: .*'x' does not exist/);
    expect(problems.join('\n')).toMatch(/\$\.y: .*'y' does not exist/);
  }, 60_000);

  it('names a missing field beside an extra one, and an extra beside a wrong kind', () => {
    expect(check('Thing', { id: 1, extra: 1 })).toEqual([
      expect.stringMatching(/: \$: .*'name' is missing/),
      expect.stringMatching(/: \$\.extra: .*'extra' does not exist/),
    ]);
    const problems = check('Thing', { id: '1', name: 'a', z: 1 });
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/\$\.z: .*'z' does not exist/);
    expect(problems.join('\n')).toMatch(/\$\.id: Type 'string' is not assignable to type 'number'/);
  }, 60_000);

  it('allows any field where the type does, but still requires the ones it names', () => {
    expect(check('Record<string, number>', { a: 1, b: 2 })).toEqual([]);
    const open = 'Thing & { [key: string]: unknown }';
    expect(check(open, { id: 1, name: 'a', extra: 1 })).toEqual([]);
    expect(check(open, { id: 1, extra: 1 })).toEqual([
      expect.stringMatching(/: \$: .*'name' is missing/),
    ]);
  }, 60_000);

  it('fails every answer when its type cannot be found, never passes them', () => {
    const missing = `import type { Thing } from ${JSON.stringify(path.join(import.meta.dirname, 'fixtures/absent.model'))};`;
    expect(check('Thing', { id: 1, name: 'a' }, missing).join('\n')).toMatch(/Cannot find module/);
  }, 60_000);
});
