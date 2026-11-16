import type { ExpressionRow } from '../../../../model/expression.model';

/**
 * The heatmap's colour scale, shared with the anatomogram so an organ and its
 * cell are the same shade (spec 024, FR-005, FR-015): log10(median + 1)
 * against the selection's top, between two theme colours.
 */

/** The top of the scale: the largest median among the rows, never under 10 TPM. */
export function topOf(rows: ExpressionRow[]): number {
  let top = 10;
  for (const row of rows)
    for (const cell of row.values) if (cell && (cell[2] ?? 0) > top) top = cell[2] ?? top;
  return top;
}

/** Where a median sits on the scale, from 0 to 1. */
export function scalePosition(median: number, top: number): number {
  return Math.min(1, Math.log10(median + 1) / Math.log10(top + 1));
}

export type Rgb = [number, number, number];

/** The colour a median is drawn in, between `low` and `high`. */
export function shade(median: number, top: number, low: Rgb, high: Rgb): string {
  const p = scalePosition(median, top);
  const mix = (i: number) => Math.round((low[i] ?? 0) + ((high[i] ?? 0) - (low[i] ?? 0)) * p);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/**
 * A theme token's colour as red, green and blue, as the page resolves it: a
 * probe element's computed colour is always `rgb(...)`, whatever form the
 * token is written in.
 */
export function tokenRgb(host: HTMLElement, token: string, fallback: Rgb): Rgb {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  probe.style.display = 'none';
  host.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = /rgba?\(([^)]+)\)/
    .exec(computed)?.[1]
    ?.split(',')
    .map((part) => Number(part.trim()));
  return parts && parts.length >= 3 && parts.every((part) => Number.isFinite(part))
    ? [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    : fallback;
}
