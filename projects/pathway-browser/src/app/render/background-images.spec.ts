import { describe, expect, it, vi } from 'vitest';
import type cytoscape from 'cytoscape';
import { backgroundImages, whenLoaded, type Loadable } from './background-images';

/** An image that loads (or fails) when told to. */
function image(complete = false): Loadable & { finish(type?: 'load' | 'error'): void } {
  const listeners: Record<'load' | 'error', (() => void)[]> = { load: [], error: [] };
  let done = complete;
  return {
    get complete() {
      return done;
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    finish(type = 'load') {
      done = true;
      for (const listener of listeners[type]) listener();
    },
  };
}

describe('whenLoaded', () => {
  it('waits for every image still loading, not only the first', async () => {
    const images = [image(), image(), image(true)];
    let resolved: boolean | undefined;
    void whenLoaded(images).then((value) => (resolved = value));
    images[0]?.finish();
    await Promise.resolve();
    expect(resolved).toBeUndefined();
    images[1]?.finish();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('takes a failed image as settled', async () => {
    const images = [image(), image()];
    const loaded = whenLoaded(images);
    images[0]?.finish('error');
    images[1]?.finish();
    expect(await loaded).toBe(true);
  });

  it('an image that fires both load and error is counted once', async () => {
    const images = [image(), image()];
    let resolved: boolean | undefined;
    void whenLoaded(images).then((value) => (resolved = value));
    images[0]?.finish('load');
    images[0]?.finish('error');
    await Promise.resolve();
    expect(resolved).toBeUndefined();
  });

  it('says so when an image is still loading after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const loaded = whenLoaded([image()], 1_000);
      vi.advanceTimersByTime(1_000);
      expect(await loaded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nothing loading resolves at once', async () => {
    expect(await whenLoaded([image(true)])).toBe(true);
    expect(await whenLoaded([])).toBe(true);
  });
});

describe('backgroundImages', () => {
  it("asks the renderer's cache for each node's every image, with its cross-origin", () => {
    const asked: [string, unknown][] = [];
    const node = (urls: unknown, crossOrigins: unknown = []) => ({
      pstyle: (name: string) => ({
        value: name === 'background-image' ? urls : crossOrigins,
      }),
    });
    const nodes = [
      node(['data:a', 'data:b'], ['anonymous', 'use-credentials']),
      node(['none']),
      node(['']),
      node('not a list'),
      node(['https://example.org/c.png'], ['null']),
    ];
    const cy = {
      renderer: () => ({
        getCachedImage: (url: string, crossOrigin: unknown) => {
          asked.push([url, crossOrigin]);
          return image(true);
        },
      }),
      nodes: () => ({ forEach: (each: (node: unknown) => void) => nodes.forEach(each) }),
    } as unknown as cytoscape.Core;
    expect(backgroundImages(cy)).toHaveLength(3);
    expect(asked).toEqual([
      ['data:a', 'anonymous'],
      ['data:b', 'use-credentials'],
      ['https://example.org/c.png', 'null'],
    ]);
  });

  it('a graph with no canvas renderer has none', () => {
    const cy = { renderer: () => ({}), nodes: () => [] } as unknown as cytoscape.Core;
    expect(backgroundImages(cy)).toEqual([]);
  });
});
