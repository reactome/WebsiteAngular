import type { RenderGrouping } from '../../../../contract/render.ts';

/**
 * The shapes in drawing order, with each group's shapes brought together at
 * the place of its first one. Within a group, and between ungrouped shapes,
 * the order is unchanged.
 */
export function gatherGroups<T extends RenderGrouping>(shapes: T[]): T[] {
  const members = new Map<string, T[]>();
  for (const shape of shapes) {
    if (!shape.group) continue;
    const list = members.get(shape.group);
    if (list) list.push(shape);
    else members.set(shape.group, [shape]);
  }
  const out: T[] = [];
  const placed = new Set<string>();
  for (const shape of shapes) {
    if (!shape.group) out.push(shape);
    else if (!placed.has(shape.group)) {
      placed.add(shape.group);
      out.push(...(members.get(shape.group) ?? []));
    }
  }
  return out;
}
