import { describe, expect, it } from 'vitest';
import { CacheTotal } from './cache-total.ts';

describe("the render cache's running total (spec 018 T020)", () => {
  /** A scan that reports `size` and counts how often it was asked. */
  const counting = (size: () => number) => {
    const scans = { n: 0 };
    return { scans, scan: async () => (scans.n++, size()) };
  };

  it('reads the folder for the first write only, then adds each write', async () => {
    const { scans, scan } = counting(() => 1000);
    const total = new CacheTotal(scan);
    expect(await total.afterWrite(100, 0)).toBe(1000);
    expect(await total.afterWrite(50, 0)).toBe(1050);
    expect(await total.afterWrite(25, 0)).toBe(1075);
    expect(scans.n, 'one read of the folder for three writes').toBe(1);
  });

  it('takes off the size of the file a write replaced', async () => {
    const total = new CacheTotal(async () => 500);
    await total.afterWrite(100, 0);
    expect(await total.afterWrite(80, 120)).toBe(460);
  });

  it('reads the folder again every so many writes, so drift does not last', async () => {
    let onDisk = 0;
    const { scans, scan } = counting(() => onDisk);
    const total = new CacheTotal(scan, 3);
    onDisk = 10;
    expect(await total.afterWrite(10, 0)).toBe(10);
    expect(await total.afterWrite(10, 0)).toBe(20);
    onDisk = 999; // another process wrote to the same folder
    expect(await total.afterWrite(10, 0), 'the third write reads the folder').toBe(999);
    expect(scans.n).toBe(2);
  });

  it('starts again from the total an eviction left', async () => {
    const total = new CacheTotal(async () => 5000);
    await total.afterWrite(100, 0);
    total.set(1800);
    expect(await total.afterWrite(100, 0)).toBe(1900);
  });
});
