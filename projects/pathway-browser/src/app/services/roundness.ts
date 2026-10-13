import { Position } from 'cytoscape';

/**
 * Add roundness to a segment edge by adding for each anchor position an additional point just before and just after
 * at a distance of radius from the original anchor point.
 *
 * With Cytoscape Bezier edges, this renders as a segmented edges with smoothed corner.
 * For a schematic explanation, @see https://raw.githubusercontent.com/reactome-pwp/PathwayBrowser/main/doc/smooth-segments.png
 *
 * @param source The position of the source node
 * @param target The position of the target node
 * @param anchors The intermediate segment points
 * @param radius How far away the new points need to be from the anchor points.
 * A bigger radius means smoother corners,
 * but it shouldn't be bigger than the segment
 * @private
 */
export function addRoundness(
  source: Position,
  target: Position,
  anchors: Position[],
  radius = 60
): Position[] {
  const output: Position[] = [];
  if (anchors.length === 0) return output;

  const points = [source, ...anchors, target];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    const next = points[i + 1]!;

    // Scaling to fit to radius
    const [toPrevious, toNext] = scaleTo([minus(previous, current), minus(next, current)], radius);

    output.push(plus(current, toPrevious!), { x: current.x, y: current.y }, plus(current, toNext!));
  }
  return output;
}

/**
 * Scale a list of vectors to a desired length.
 *
 * If limit is true, limiting the resulting length to half the minimum norm of all vectors, in order to avoid clashing
 * @param vectors
 * @param length
 * @param limit
 * @private
 */
function scaleTo(vectors: Position[], length: number, limit = true): Position[] {
  const norms = vectors.map((vector) => Math.hypot(vector.x, vector.y));
  if (limit) {
    const minNorm = Math.min(...norms);
    if (length >= minNorm) length = minNorm / 2.1;
  }
  return vectors.map((vector, i) => {
    const factor = length / norms[i]!;
    return { x: vector.x * factor, y: vector.y * factor };
  });
}

const minus = (a: Position, b: Position): Position => ({ x: a.x - b.x, y: a.y - b.y });
const plus = (a: Position, b: Position): Position => ({ x: a.x + b.x, y: a.y + b.y });
