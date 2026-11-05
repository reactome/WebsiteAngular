// @vitest-environment node
//
// JavaHashMap against the JDK's own HashSet: the orders below were printed by
// OpenJDK 11 for the same keys (a scratch program, not kept: a class whose
// hashCode is Objects.hash(id), as reaction-exporter's glyphs are, added one
// by one or copied with new HashSet<>(list); and GO ids as strings).
import { describe, expect, it } from 'vitest';
import { JavaHashMap } from './java-hashmap.ts';

/** A set of glyph ids, hashed as Objects.hash(id). */
const glyphSet = (options: { capacity?: number } = {}) =>
  new JavaHashMap<number, true>({ hash: JavaHashMap.longObjectsHash, ...options });

const JDK_ADDED: [start: number, count: number, order: number[]][] = [
  [1, 5, [1, 4, 7, 10, 13]],
  [1, 13, [1, 34, 4, 37, 7, 10, 13, 16, 19, 22, 25, 28, 31]],
  [
    1,
    30,
    [
      34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 1, 67, 4, 70, 7, 73, 10, 76, 13, 79, 16, 82, 19,
      85, 22, 88, 25, 28, 31,
    ],
  ],
  [7, 5, [19, 7, 10, 13, 16]],
  [7, 13, [34, 37, 7, 40, 10, 43, 13, 16, 19, 22, 25, 28, 31]],
  [
    7,
    30,
    [
      34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70, 7, 73, 10, 76, 13, 79, 16, 82, 19, 85, 22,
      88, 25, 91, 28, 94, 31,
    ],
  ],
  [159853, 5, [159859, 159862, 159865, 159856, 159853]],
  [
    159853,
    13,
    [
      159874, 159880, 159877, 159883, 159856, 159853, 159886, 159859, 159889, 159862, 159868,
      159865, 159871,
    ],
  ],
  [
    159853,
    30,
    [
      159907, 159910, 159916, 159913, 159919, 159856, 159853, 159859, 159922, 159928, 159925,
      159862, 159931, 159868, 159865, 159871, 159934, 159940, 159937, 159874, 159880, 159877,
      159883, 159886, 159892, 159889, 159895, 159898, 159904, 159901,
    ],
  ],
  [4000000000, 5, [4000000012, 4000000009, 4000000000, 4000000003, 4000000006]],
  [
    4000000000,
    13,
    [
      4000000012, 4000000009, 4000000015, 4000000036, 4000000003, 4000000033, 4000000006,
      4000000027, 4000000000, 4000000030, 4000000018, 4000000024, 4000000021,
    ],
  ],
  [
    4000000000,
    30,
    [
      4000000012, 4000000075, 4000000009, 4000000015, 4000000078, 4000000003, 4000000066,
      4000000072, 4000000006, 4000000069, 4000000027, 4000000030, 4000000084, 4000000018,
      4000000081, 4000000024, 4000000087, 4000000021, 4000000042, 4000000048, 4000000045,
      4000000036, 4000000033, 4000000039, 4000000060, 4000000057, 4000000000, 4000000063,
      4000000051, 4000000054,
    ],
  ],
];

// Ids 1, 8, 15 ... -- ones whose order depends on the table's size: filled
// one by one, a set of 12 or 24 would iterate differently.
const JDK_COPIED: [count: number, order: number[]][] = [
  [11, [1, 50, 36, 22, 71, 8, 57, 43, 29, 15, 64]],
  [12, [1, 36, 71, 8, 43, 78, 15, 50, 22, 57, 29, 64]],
  [
    23,
    [
      1, 99, 36, 134, 71, 8, 106, 43, 141, 78, 15, 113, 50, 148, 85, 22, 120, 57, 155, 92, 29, 127,
      64,
    ],
  ],
  [
    24,
    [
      162, 99, 36, 106, 43, 113, 50, 120, 57, 127, 64, 1, 134, 71, 8, 141, 78, 15, 148, 85, 22, 155,
      92, 29,
    ],
  ],
  [
    25,
    [
      162, 99, 36, 169, 106, 43, 113, 50, 120, 57, 127, 64, 1, 134, 71, 8, 141, 78, 15, 148, 85, 22,
      155, 92, 29,
    ],
  ],
];

const GO_IDS = [
  'GO:0005576',
  'GO:0005575',
  'GO:0005829',
  'GO:0005886',
  'GO:0005634',
  'GO:0005783',
  'GO:0005788',
  'GO:0005739',
  'GO:0005743',
  'GO:0031410',
  'GO:0005654',
  'GO:0005737',
  'GO:0016020',
  'GO:0005794',
];
const JDK_GO_ORDER = [
  'GO:0005783',
  'GO:0005794',
  'GO:0005576',
  'GO:0005575',
  'GO:0005886',
  'GO:0005743',
  'GO:0005654',
  'GO:0005634',
  'GO:0005788',
  'GO:0005737',
  'GO:0005739',
  'GO:0016020',
  'GO:0005829',
  'GO:0031410',
];

describe('JavaHashMap, as a HashSet of glyphs', () => {
  it("iterates glyphs added one by one in the JDK's order, wherever their ids start", () => {
    for (const [start, count, order] of JDK_ADDED) {
      const set = glyphSet();
      for (let at = 0; at < count; at += 1) set.set(start + at * 3, true);
      expect([...set.keys()], `from ${start}, ${count}`).toEqual(order);
    }
  });

  it('starts a set copied from a collection at the size Java gives it', () => {
    for (const [count, order] of JDK_COPIED) {
      const set = glyphSet({ capacity: JavaHashMap.capacityFor(count) });
      for (let at = 0; at < count; at += 1) set.set(1 + at * 7, true);
      expect([...set.keys()], `${count} copied`).toEqual(order);
    }
  });

  it('sizes a copy as HashSet(Collection) does: 16 buckets to 11, 32 from 12, 64 from 24', () => {
    expect([11, 12, 23, 24].map((size) => JavaHashMap.capacityFor(size))).toEqual([16, 17, 31, 33]);
  });
});

describe('JavaHashMap, as a HashSet of GO ids', () => {
  it("iterates in the JDK's order", () => {
    const set = new JavaHashMap<string, true>();
    for (const id of GO_IDS) set.set(id, true);
    expect([...set.keys()]).toEqual(JDK_GO_ORDER);
  });

  it('finds, and does not find, by key', () => {
    const map = new JavaHashMap<string, number>();
    GO_IDS.forEach((id, at) => map.set(id, at));
    expect(map.get('GO:0005829')).toBe(2);
    expect(map.has('GO:0005829')).toBe(true);
    expect(map.get('GO:9999999')).toBeUndefined();
    expect(map.has('GO:9999999')).toBe(false);
    expect([...map.values()]).toEqual(JDK_GO_ORDER.map((id) => GO_IDS.indexOf(id)));
  });
});
