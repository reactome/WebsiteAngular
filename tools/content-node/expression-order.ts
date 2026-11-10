/**
 * The heatmap's row order (spec 024, FR-006, research R6): genes expressed
 * alike side by side, as readers of expression heatmaps expect. Each gene is
 * its log10(median + 1) across tissues; genes are joined by average linkage on
 * correlation distance and read off the tree, the subtree holding the
 * alphabetically first gene first, so one selection always draws one way.
 * Above MAX_CLUSTERED genes, which keeps the distance matrix to 36 MB, genes
 * are ordered by the tissue each is highest in, then by that value.
 */

/** One gene to place. */
export interface OrderInput {
  name: string;
  gene: string;
  /** One median per tissue; NaN where the table has none. */
  medians: number[];
}

export const MAX_CLUSTERED = 3000;

const byName = (a: OrderInput | undefined, b: OrderInput | undefined) =>
  (a?.name ?? '').localeCompare(b?.name ?? '') || (a?.gene ?? '').localeCompare(b?.gene ?? '');

/** Centred, unit-length profiles, so a dot product is a correlation; null for a flat one. */
function profiles(inputs: OrderInput[]): (Float64Array | null)[] {
  return inputs.map(({ medians }) => {
    const v = Float64Array.from(medians, (m) => (Number.isNaN(m) ? 0 : Math.log10(m + 1)));
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      const centred = (v[i] ?? 0) - mean;
      v[i] = centred;
      norm += centred * centred;
    }
    if (norm < 1e-12) return null;
    const length = Math.sqrt(norm);
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / length;
    return v;
  });
}

/** Correlation distance; two flat profiles are alike, a flat and a varied one apart. */
function distance(a: Float64Array | null, b: Float64Array | null): number {
  if (!a || !b) return a === b ? 0 : 1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return 1 - dot;
}

/** Highest tissue first, then the value there, then name. */
function byPeak(inputs: OrderInput[]): number[] {
  const peak = inputs.map(({ medians }) => {
    let best = -1;
    let value = -Infinity;
    medians.forEach((m, t) => {
      if (!Number.isNaN(m) && m > value) [best, value] = [t, m];
    });
    return { best, value };
  });
  return inputs
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (peak[a]?.best ?? 0) - (peak[b]?.best ?? 0) ||
        (peak[b]?.value ?? 0) - (peak[a]?.value ?? 0) ||
        byName(inputs[a], inputs[b])
    );
}

/** The order to draw `inputs` in, as indices into it. */
export function orderRows(inputs: OrderInput[]): number[] {
  if (inputs.length <= 2)
    return inputs.map((_, i) => i).sort((a, b) => byName(inputs[a], inputs[b]));
  if (inputs.length > MAX_CLUSTERED) return byPeak(inputs);

  // Start from name order, so the answer does not depend on the input's order.
  const start = inputs.map((_, i) => i).sort((a, b) => byName(inputs[a], inputs[b]));
  const n = start.length;
  const vectors = profiles(start.flatMap((i) => inputs[i] ?? []));
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      d[i * n + j] = d[j * n + i] = distance(vectors[i] ?? null, vectors[j] ?? null);

  // Nearest-neighbour chain: average linkage in O(n^2). Cluster i keeps index
  // i; its leaves are `leaves[i]`, already in drawing order.
  const active = new Uint8Array(n).fill(1);
  const size = new Uint32Array(n).fill(1);
  const leaves: number[][] = start.map((_, i) => [i]);
  const chain: number[] = [];
  let remaining = n;
  while (remaining > 1) {
    if (!chain.length) chain.push(active.indexOf(1));
    const a = chain[chain.length - 1] ?? 0;
    const previous = chain.length > 1 ? (chain[chain.length - 2] ?? -1) : -1;
    let b = previous;
    let best = previous >= 0 ? (d[a * n + previous] ?? Infinity) : Infinity;
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a) continue;
      const dk = d[a * n + k] ?? Infinity;
      if (dk < best) [b, best] = [k, dk];
    }
    if (b !== previous) {
      chain.push(b);
      continue;
    }
    chain.length -= 2;
    // Merge b into a: the Lance-Williams update for average linkage.
    const [sa, sb] = [size[a] ?? 1, size[b] ?? 1];
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a || k === b) continue;
      const merged = (sa * (d[a * n + k] ?? 0) + sb * (d[b * n + k] ?? 0)) / (sa + sb);
      d[a * n + k] = d[k * n + a] = merged;
    }
    // Leaves are indices into name order, so the smaller first leaf is the
    // alphabetically first gene.
    const [left = [], right = []] = [leaves[a], leaves[b]];
    leaves[a] = (left[0] ?? 0) < (right[0] ?? 0) ? [...left, ...right] : [...right, ...left];
    leaves[b] = [];
    size[a] = sa + sb;
    active[b] = 0;
    remaining--;
  }
  return (leaves[active.indexOf(1)] ?? []).flatMap((i) => start[i] ?? []);
}
