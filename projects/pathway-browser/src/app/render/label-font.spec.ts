import { describe, expect, it } from 'vitest';
import { type Face, loadFamily } from './label-font';

/** A face as the page declares it, counting its loads. */
function face(family: string, weight: string, style = 'normal', fails = false) {
  let loads = 0;
  const made = {
    family,
    weight,
    style,
    load: () => {
      loads++;
      return fails ? Promise.reject(new Error('offline')) : Promise.resolve(made as FontFace);
    },
    loads: () => loads,
  };
  return made satisfies Face;
}

describe('loadFamily (spec 018 T012)', () => {
  it('loads every subset of the family at the weight, and nothing else', async () => {
    // Google's stylesheet declares one face per unicode subset; the browser
    // reports a CSS family name quoted or bare.
    const latin = face('Roboto', '400');
    const greek = face('"Roboto"', '400');
    const cyrillic = face('Roboto', '400');
    const others = [
      face('Roboto', '300'),
      face('Roboto', '400', 'italic'),
      face('Roboto Mono', '400'),
      face('Material Icons', '400'),
    ];
    await loadFamily([latin, greek, cyrillic, ...others], 'Roboto', '400');
    expect([latin, greek, cyrillic].map((each) => each.loads())).toEqual([1, 1, 1]);
    expect(others.map((each) => each.loads())).toEqual([0, 0, 0, 0]);
  });

  it('waits for every one before it resolves', async () => {
    let finish = () => {};
    const slow = {
      ...face('Roboto', '400'),
      load: () => new Promise<FontFace>((resolve) => (finish = () => resolve({} as FontFace))),
    };
    let done = false;
    const loading = loadFamily([face('Roboto', '400'), slow], 'Roboto', '400').then(
      () => (done = true)
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await loading;
    expect(done).toBe(true);
  });

  it('resolves when a face fails to load', async () => {
    const offline = face('Roboto', '400', 'normal', true);
    await expect(loadFamily([offline], 'Roboto', '400')).resolves.toBeUndefined();
    expect(offline.loads()).toBe(1);
  });
});
