/**
 * A connector's id, unique in its diagram.
 *
 * The id is made from its ends and its type, so two connectors with the same
 * ends and type would share one; cytoscape refuses a second element with an id
 * it already has, and the diagram would not draw. Each repeat is numbered: the
 * second " (1)", the third " (2)", and so on. `seen` counts the repeats of each
 * id so far.
 */
export function uniqueEdgeId(id: string, seen: Map<string, number>): string {
  const repeats = seen.get(id);
  if (repeats === undefined) {
    seen.set(id, 0);
    return id;
  }
  const n = repeats + 1;
  seen.set(id, n);
  return `${id} (${n})`;
}
