import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Face } from '../render/label-font';
import { diagramFontsReady } from './diagram-fonts';

/** A face as the page declares it, loading when told to. */
function face(family: string, weight: string) {
  let loads = 0;
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const made = {
    family,
    weight,
    style: 'normal',
    load: () => {
      loads++;
      return done.then(() => made as FontFace);
    },
    loads: () => loads,
    finish: () => finish(),
  };
  return made satisfies Face;
}

describe('diagramFontsReady (spec 009 T045)', () => {
  afterEach(() => vi.useRealTimers());

  it("loads the diagram's faces, and nothing else", async () => {
    const wanted = [
      face('Roboto', '400'),
      face('Roboto', '500'),
      face('"Roboto Mono"', '400'),
      face('Roboto Mono', '700'),
    ];
    const others = [face('Roboto', '300'), face('Material Icons', '400')];
    const ready = diagramFontsReady([...wanted, ...others], 60_000);
    wanted.forEach((each) => each.finish());
    await ready;
    expect(wanted.map((each) => each.loads())).toEqual([1, 1, 1, 1]);
    expect(others.map((each) => each.loads())).toEqual([0, 0]);
  });

  it('waits until they have all loaded', async () => {
    vi.useFakeTimers();
    const roboto = face('Roboto', '400');
    const mono = face('Roboto Mono', '400');
    let settled = false;
    void diagramFontsReady([roboto, mono], 2000).then(() => (settled = true));
    roboto.finish();
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);
    mono.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it('reads the faces once the font stylesheets the embed added have loaded', async () => {
    // On a partner's page the embed adds the font stylesheets as it starts, so
    // a diagram can be ready before they have declared a face; read then, there
    // was nothing to wait for, and the diagram was framed in a fallback font.
    vi.useFakeTimers();
    const faces: Face[] = [];
    let sheetLoaded = () => {};
    const sheets = new Promise<void>((resolve) => (sheetLoaded = resolve));
    let settled = false;
    void diagramFontsReady(faces, 2000, sheets).then(() => (settled = true));
    const roboto = face('Roboto', '400');
    faces.push(roboto);
    sheetLoaded();
    await vi.advanceTimersByTimeAsync(100);
    expect(roboto.loads()).toBe(1);
    expect(settled).toBe(false);
    roboto.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it('draws without them once the wait is over', async () => {
    vi.useFakeTimers();
    const never = face('Roboto', '400');
    let settled = false;
    void diagramFontsReady([never], 2000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('does not wait for faces the page has not declared', async () => {
    vi.useFakeTimers();
    let settled = false;
    void diagramFontsReady([face('Material Icons', '400')], 2000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});
