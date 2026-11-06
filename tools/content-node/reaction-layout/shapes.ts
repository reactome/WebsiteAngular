/**
 * What diagram-reader (1.2.5, as ContentService deploys it) does with a
 * reaction layout's connectors and shapes (research D22, step 3): a
 * connector's end shape, made when its type is set (ConnectorImpl.setPointer)
 * from its segments, and the arrows and stops ShapeBuilder draws. Read from
 * the deployed jar's bytecode: the arithmetic is in Java's order, so each
 * value's last bit agrees with Java's.
 */
import type { Segment } from './sizes.ts';

/** A coordinate: Java's are immutable, so a moved one is a new one. */
export interface Coordinate {
  x: number;
  y: number;
}

/** ShapeImpl's fields, in its order; Jackson leaves out the null ones. */
export interface Shape {
  a?: Coordinate;
  b?: Coordinate;
  c?: Coordinate;
  r?: number;
  r1?: number;
  s?: string;
  type: 'ARROW' | 'BOX' | 'CIRCLE' | 'DOUBLE_CIRCLE' | 'STOP';
  empty?: boolean;
}

export interface Stoichiometry {
  value: number;
  shape?: Shape;
}

export type ConnectorType = 'INPUT' | 'OUTPUT' | 'CATALYST' | 'INHIBITOR' | 'ACTIVATOR';

/** ConnectorImpl: what ConnectorFactory fills in, then the diagram's edge and flags. */
export interface Connector {
  type?: ConnectorType;
  segments: Segment[];
  endShape?: Shape;
  stoichiometry?: Stoichiometry;
}

/** CoordinateImpl.add. */
export const add = (point: Coordinate, delta: Coordinate): Coordinate => ({
  x: point.x + delta.x,
  y: point.y + delta.y,
});

export const segment = (x1: number, y1: number, x2: number, y2: number): Segment => ({
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});

/** BoxImpl(a, b, empty, s). */
export const box = (a: Coordinate, b: Coordinate, empty: boolean, s: string | null): Shape => ({
  a,
  b,
  ...(s === null ? {} : { s }),
  type: 'BOX',
  empty,
});

const ARROW_LENGTH = 8;
const ARROW_ANGLE = 0.5235987755982988;

/** ShapeBuilder.createArrow: an arrow head at (x0, y0), pointing away from (x1, y1). */
type Three = [Coordinate, Coordinate, Coordinate];

function createArrow(x0: number, y0: number, x1: number, y1: number): Three {
  let alpha = Math.atan((y0 - y1) / (x0 - x1));
  if (x1 > x0) alpha += Math.PI;
  let angle = ARROW_ANGLE - alpha;
  const p1 = {
    x: x0 - ARROW_LENGTH * Math.cos(angle),
    y: y0 + ARROW_LENGTH * Math.sin(angle),
  };
  angle = ARROW_ANGLE + alpha;
  const p3 = {
    x: x0 - ARROW_LENGTH * Math.cos(angle),
    y: y0 - ARROW_LENGTH * Math.sin(angle),
  };
  return [p1, { x: x0, y: y0 }, p3];
}

/** ShapeBuilder.createStop: a bar across (x0, y0), square to the line from (x1, y1). */
function createStop(x0: number, y0: number, x1: number, y1: number): Three {
  const dy = y0 - y1;
  const dx = x1 - x0;
  // dcmpl against 0: -0.0 is 0 too.
  const angle = dy === 0 ? 1.5707963267948966 : Math.atan(-dx / dy);
  return [
    {
      x: x0 - (Math.cos(angle) * ARROW_LENGTH) / 2,
      y: y0 + (Math.sin(angle) * ARROW_LENGTH) / 2,
    },
    {
      x: x0 + (Math.cos(angle) * ARROW_LENGTH) / 2,
      y: y0 - (Math.sin(angle) * ARROW_LENGTH) / 2,
    },
    { x: x0, y: y0 },
  ];
}

/** ConnectorImpl.calculateEndpoint: the point `distance` back from the segment's end, towards its start. */
function endpoint({ from, to }: Segment, distance: number): Coordinate {
  let angle = Math.atan((from.y - to.y) / (from.x - to.x));
  if (from.x - to.x < 0) angle += Math.PI;
  return { x: to.x + distance * Math.cos(angle), y: to.y + distance * Math.sin(angle) };
}

/** getDistanceForEndpoint: 12 and the extra for a catalyst, 9 for anything else. */
const distanceFor = (type: ConnectorType, extra = 0) => (type === 'CATALYST' ? 12 + extra : 9);

/**
 * ConnectorImpl.setPointer: the type, and the end shape it draws. A
 * catalyst's and an inhibitor's last segment is replaced by one that stops
 * short of the shape, so setting either type twice shortens it twice, as in
 * Java.
 */
export function setPointer(connector: Connector, type: ConnectorType) {
  connector.type = type;
  const segments = connector.segments;
  if (!segments.length) return;
  switch (type) {
    case 'INPUT':
      return;
    case 'OUTPUT': {
      const first = segments[0] as Segment;
      const [a, b, c] = createArrow(first.from.x, first.from.y, first.to.x, first.to.y);
      connector.endShape = arrow(a, b, c, false);
      return;
    }
    case 'CATALYST': {
      const last = segments[segments.length - 1] as Segment;
      const radius = 4;
      const centre = endpoint(last, distanceFor(type));
      segments.splice(segments.indexOf(last), 1);
      segments.push({ from: last.from, to: endpoint(last, distanceFor(type, radius)) });
      connector.endShape = { c: centre, r: radius, type: 'CIRCLE', empty: true };
      return;
    }
    case 'INHIBITOR': {
      const last = segments[segments.length - 1] as Segment;
      segments.splice(segments.indexOf(last), 1);
      const shortened = { from: last.from, to: endpoint(last, distanceFor(type)) };
      segments.push(shortened);
      const [a, b, c] = createStop(
        shortened.to.x,
        shortened.to.y,
        shortened.from.x,
        shortened.from.y
      );
      connector.endShape = { a, b, c, type: 'STOP' };
      return;
    }
    case 'ACTIVATOR': {
      const last = segments[segments.length - 1] as Segment;
      const [a, b, c] = createArrow(last.to.x, last.to.y, last.from.x, last.from.y);
      connector.endShape = arrow(a, b, c, true);
      return;
    }
  }
}

/** ArrowImpl(a, b, c, empty). */
const arrow = (a: Coordinate, b: Coordinate, c: Coordinate, empty: boolean): Shape => ({
  a,
  b,
  c,
  type: 'ARROW',
  empty,
});
