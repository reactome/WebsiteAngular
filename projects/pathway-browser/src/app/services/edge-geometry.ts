import { Position } from '../model/diagram.model';

/** Points along an edge: how far along it (weights) and how far off it (distances). */
export type RelativePosition = { distances: number[]; weights: number[] };

export const equal = (pos1: Position, pos2: Position) => pos1.x === pos2.x && pos1.y === pos2.y;

export const isFinitePoint = (point: Position | undefined | null): point is Position =>
  !!point && Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * Convert points from an absolute coordinate system to an edge relative system
 *
 * Visually explained by https://youtu.be/kYB8IZa5AuE?si=vJKi-MUv2dCRQ5oA<br>
 * Short version ==> https://math.stackexchange.com/q/1855051/683621
 * @param source Position position of the edge source:  {x:number, y:number}
 * @param target Position position of the edge target:  {x:number, y:number}
 * @param toConvert Array of Position to convert to the edge-relative system
 * @return The points converted to relative coordinates {distances: number[], weights: number[]}
 */
export function absoluteToRelative(
  source: Position,
  target: Position,
  toConvert: Position[]
): RelativePosition {
  const relatives: RelativePosition = { distances: [], weights: [] };
  if (toConvert.length === 0) return relatives;

  if (!isFinitePoint(source) || !isFinitePoint(target) || equal(source, target)) return relatives;

  // The edge, and the unit vector at right angles to it, so a distance comes out
  // in pixels (https://math.stackexchange.com/a/413235/683621).
  const mx = target.x - source.x;
  const my = target.y - source.y;
  if (mx === 0 && my === 0) return relatives;
  const length = Math.hypot(mx, my);
  const ox = -my / length;
  const oy = mx / length;
  // A point is weight * edge + distance * ortho. Solving for the two is
  // multiplying by the inverse of [[mx, my], [ox, oy]], written out: a 2x2
  // matrix needs no library. Never singular, as ortho is perpendicular.
  const det = mx * oy - my * ox;

  for (const coord of toConvert) {
    if (!isFinitePoint(coord)) continue;
    const ax = coord.x - source.x;
    const ay = coord.y - source.y;
    const weight = (ax * oy - ay * ox) / det;
    const distance = (ay * mx - ax * my) / det;
    if (!Number.isFinite(weight) || !Number.isFinite(distance)) continue;
    relatives.weights.push(weight);
    relatives.distances.push(distance);
  }
  return relatives;
}
