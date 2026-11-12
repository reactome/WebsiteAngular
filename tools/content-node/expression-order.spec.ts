// @vitest-environment node
//
// The heatmap's row order (spec 024, T008-T009): alike genes side by side,
// one selection one order, and quick enough for the largest pathways.
import { describe, expect, it } from 'vitest';
import { MAX_CLUSTERED, orderRows } from './expression-order.ts';
import type { OrderInput } from './expression-order.ts';

const gene = (name: string, medians: number[]): OrderInput => ({
  name,
  gene: `ENSG_${name}`,
  medians,
});

// Two patterns over six tissues: high in the first three, or in the last three.
const early = (scale: number) => [100, 90, 80, 1, 1, 1].map((m) => m * scale);
const late = (scale: number) => [1, 1, 1, 80, 90, 100].map((m) => m * scale);

/** Names interleaved alphabetically, so name order would mix the patterns. */
const MIXED = [
  gene('A1', early(1)),
  gene('B1', late(1)),
  gene('C1', early(2)),
  gene('D1', late(3)),
  gene('E1', early(5)),
  gene('F1', late(7)),
];

const namesOf = (inputs: OrderInput[], order: number[]) => order.map((i) => inputs[i]?.name);

describe('orderRows', () => {
  it('puts genes expressed alike side by side', () => {
    const names = namesOf(MIXED, orderRows(MIXED));
    const pattern = names.map((n) => (['A1', 'C1', 'E1'].includes(n ?? '') ? 'early' : 'late'));
    // One run of each: early genes together, late genes together.
    expect(pattern.filter((p, i) => i === 0 || p !== pattern[i - 1])).toHaveLength(2);
  });

  it('draws one selection one way, whatever order its genes arrive in', () => {
    const forward = namesOf(MIXED, orderRows(MIXED));
    const reversed = [...MIXED].reverse();
    expect(namesOf(reversed, orderRows(reversed))).toEqual(forward);
  });

  it('starts from the alphabetically first gene', () => {
    expect(namesOf(MIXED, orderRows(MIXED))[0]).toBe('A1');
  });

  it('keeps genes expressed nowhere together, apart from the rest', () => {
    const inputs = [...MIXED, gene('Z0', [0, 0, 0, 0, 0, 0]), gene('A0', [0, 0, 0, 0, 0, 0])];
    const names = namesOf(inputs, orderRows(inputs));
    expect(Math.abs(names.indexOf('Z0') - names.indexOf('A0'))).toBe(1);
  });

  it('orders zero, one and two genes by name', () => {
    expect(orderRows([])).toEqual([]);
    expect(orderRows([gene('X', early(1))])).toEqual([0]);
    expect(
      namesOf(
        [gene('Y', early(1)), gene('X', late(1))],
        orderRows([gene('Y', early(1)), gene('X', late(1))])
      )
    ).toEqual(['X', 'Y']);
  });

  it(`orders more than ${MAX_CLUSTERED} genes by the tissue each is highest in`, () => {
    const many = Array.from({ length: MAX_CLUSTERED + 1 }, (_, i) =>
      gene(`G${String(i).padStart(5, '0')}`, i % 2 ? late(1 + (i % 7)) : early(1 + (i % 5)))
    );
    const order = orderRows(many);
    const peaks = order.map((i) => {
      const medians = many[i]?.medians ?? [];
      return medians.indexOf(Math.max(...medians));
    });
    expect(peaks).toEqual([...peaks].sort((a, b) => a - b));
  });

  it('orders the largest it clusters in O(n^2) work, counted rather than timed', () => {
    // SC-004 asks the largest pathway (2,500 genes) be answered within 5 s:
    // 481 ms when measured on 2026-11-10. A clock made this fail on a busy
    // machine, so the clustering's work is counted instead: 4.2 to 4.45 n^2
    // gene visits from 100 genes to MAX_CLUSTERED, measured 2026-11-12. A
    // cubic step would be n times the bound. The count covers the clustering's
    // loops; a new loop must count its visits too, or this cannot see it.
    let seed = 7;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const n = MAX_CLUSTERED;
    const inputs = Array.from({ length: n }, (_, i) =>
      gene(
        `G${i}`,
        Array.from({ length: 29 }, () => random() * 1000)
      )
    );
    const work = { visits: 0 };
    const order = orderRows(inputs, work);
    expect(new Set(order).size).toBe(n);
    expect(work.visits).toBeGreaterThan(n * n);
    expect(work.visits).toBeLessThan(6 * n * n);
  });
});
