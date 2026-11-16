import { describe, expect, it } from 'vitest';
import { uniqueEdgeId } from './edge-id';

describe('uniqueEdgeId', () => {
  it('keeps an id seen for the first time as it is', () => {
    expect(uniqueEdgeId('1 --input 2', new Map())).toBe('1 --input 2');
  });

  it('numbers each repeat of an id, so no two connectors share one', () => {
    const seen = new Map<string, number>();
    const ids = [1, 2, 3, 4].map(() => uniqueEdgeId('1 --input 2', seen));
    expect(ids).toEqual(['1 --input 2', '1 --input 2 (1)', '1 --input 2 (2)', '1 --input 2 (3)']);
    expect(new Set(ids).size).toBe(4);
  });

  it('counts each id on its own', () => {
    const seen = new Map<string, number>();
    uniqueEdgeId('a', seen);
    uniqueEdgeId('a', seen);
    expect(uniqueEdgeId('b', seen)).toBe('b');
    expect(uniqueEdgeId('b', seen)).toBe('b (1)');
  });
});
