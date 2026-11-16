/**
 * reaction-exporter's ConnectorFactory (research D22, step 3): the lines from
 * each participant to the reaction, once everything is placed -- inputs and
 * outputs to the backbone through a vertical rule each, catalysts down to
 * the reaction, regulators to points on a half circle beneath it.
 *
 * Where Java loops over an entity's roles, the order is the roles' (D21): a
 * connector made for every role takes the last role's stoichiometry and
 * type, and each type set again redraws the end (shapes.ts).
 */
import type { Bounds } from './bounds.ts';
import type { Grid } from './grid.ts';
import { HorizontalLayout } from './layouts.ts';
import type { Div } from './layouts.ts';
import type { LayoutIndex } from './layout-index.ts';
import { JavaNullPointerException } from './model.ts';
import type { EntityGlyph, EntityRole, ReactionGlyph, Role } from './model.ts';
import { box, segment, setPointer } from './shapes.ts';
import type { Connector, ConnectorType, Stoichiometry } from './shapes.ts';
import type { Segment } from './sizes.ts';
import { boundsOf } from './transformer.ts';
import type { Point } from './box.ts';

const BACKBONE_LENGTH = 20;
const REGULATOR_SIZE = 6;
const MIN_SEGMENT = 50;
const GENE_SEGMENT_LENGTH = 20;

/** addConnectors: every participant's connectors, from the grid's sizes. */
export function addConnectors(
  reactionPosition: Point,
  grid: Grid<Div>,
  widths: number[],
  heights: number[],
  reaction: ReactionGlyph,
  index: LayoutIndex
) {
  // The right edge of the last column of inputs, the bottom of the last row
  // of catalysts, and the left edge of the first column of outputs.
  let x1 = 0;
  let y1 = 0;
  let i = reactionPosition.col - 1;
  while (i >= 0 && !hasRole(grid.getColumn(i), 'input')) i -= 1;
  for (let j = 0; j <= i; j += 1) x1 += widths[j] as number;
  i = reactionPosition.row - 1;
  while (i >= 0 && !hasRole(grid.getRow(i), 'catalyst')) i -= 1;
  for (let j = 0; j <= i; j += 1) y1 += heights[j] as number;
  let x2 = 0;
  i = 0;
  while (i < grid.columns && !hasRole(grid.getColumn(i), 'output')) x2 += widths[i++] as number;

  const bounds = reaction.bounds;
  const cx = bounds.cx;
  const cy = bounds.cy;
  const rx1 = bounds.x - BACKBONE_LENGTH;
  const rx2 = bounds.mx + BACKBONE_LENGTH;
  inputs(index, x1, rx1, cy, cx);
  outputs(index, x2, rx2, cy);
  catalysts(index, grid, reactionPosition, cx, y1, cy);
  regulators(index, grid, reactionPosition);
}

/** A new connector, added to the entity. */
function newConnector(entity: EntityGlyph, segments: Segment[]): Connector {
  const connector: Connector = { segments };
  entity.connectors.push(connector);
  return connector;
}

function connectorType(type: EntityRole): ConnectorType {
  switch (type) {
    case 'output':
      return 'OUTPUT';
    case 'catalyst':
      return 'CATALYST';
    case 'negative':
      return 'INHIBITOR';
    case 'positive':
      return 'ACTIVATOR';
    case 'input':
      return 'INPUT';
  }
}

/** getStoichiometry: 1 without a shape, otherwise a box with the number on the first segment's middle. */
function stoichiometry(segments: Segment[], role: Role): Stoichiometry {
  if (role.n === 1) return { value: 1 };
  const { from, to } = segments[0] as Segment;
  const centre = { x: 0.5 * (from.x + to.x), y: 0.5 * (from.y + to.y) };
  const a = { x: centre.x - 6, y: centre.y - 6 };
  const b = { x: centre.x + 6, y: centre.y + 6 };
  return { value: role.n, shape: box(a, b, true, String(role.n)) };
}

function hasRole(divs: (Div | null)[] | null, role: EntityRole): boolean {
  // getRow and getColumn are asked only inside the grid.
  if (!divs) throw new JavaNullPointerException();
  return divs.some((div) => div?.containedRoles().has(role));
}

function inputs(index: LayoutIndex, x: number, rx: number, cy: number, cx: number) {
  for (const entity of index.inputs) {
    const bounds = boundsOf(entity);
    for (const role of entity.roles) {
      if (role.type === 'input') {
        const segments: Segment[] = [];
        const connector = newConnector(entity, segments);
        if (entity.renderableClass === 'Gene') {
          // A gene's arrow leaves from its top right corner.
          segments.push(
            segment(bounds.mx + 8, bounds.y, bounds.mx + GENE_SEGMENT_LENGTH, bounds.cy),
            segment(bounds.mx + GENE_SEGMENT_LENGTH, bounds.cy, x, bounds.cy),
            segment(x, bounds.cy, rx, cy)
          );
        } else {
          segments.push(segment(bounds.mx, bounds.cy, x, bounds.cy), segment(x, bounds.cy, rx, cy));
        }
        setPointer(connector, 'INPUT');
        connector.stoichiometry = stoichiometry(segments, role);
      } else if (role.type === 'catalyst') {
        // An input that is also a catalyst: a line over its top to the reaction.
        const segments: Segment[] = [];
        const connector = newConnector(entity, segments);
        connector.stoichiometry = { value: 1 };
        const top = Math.min(bounds.y - 10, cy - 50);
        const catalystPosition = cx - 20;
        segments.push(
          segment(bounds.cx, bounds.y, bounds.cx, top),
          segment(bounds.cx, top, catalystPosition, top),
          segment(catalystPosition, top, cx, cy)
        );
        setPointer(connector, 'CATALYST');
      }
    }
  }
}

function outputs(index: LayoutIndex, x2: number, rx2: number, cy: number) {
  for (const entity of index.outputs) {
    const bounds = boundsOf(entity);
    connect(entity, [
      segment(bounds.x - 4, bounds.cy, x2, bounds.cy),
      segment(x2, bounds.cy, rx2, cy),
    ]);
  }
}

/** Every catalyst row above the reaction, column by column. */
function catalysts(
  index: LayoutIndex,
  grid: Grid<Div>,
  reactionPosition: Point,
  cx: number,
  y1: number,
  cy: number
) {
  const many = index.catalysts.length > 1;
  for (let c = 0; c < grid.columns; c += 1)
    for (let r = 0; r < reactionPosition.row; r += 1) {
      const div = grid.get(r, c);
      if (!(div instanceof HorizontalLayout)) continue;
      for (const glyph of div.glyphs) {
        const entity = glyph as EntityGlyph;
        const bounds = boundsOf(entity);
        if (c === reactionPosition.col || many) {
          connect(entity, [
            segment(bounds.cx, bounds.my, bounds.cx, y1),
            segment(bounds.cx, y1, cx, cy),
          ]);
        } else if (c < reactionPosition.col) {
          // As an input.
          const x = bounds.mx + MIN_SEGMENT;
          connect(entity, [
            segment(bounds.mx, bounds.cy, x, bounds.cy),
            segment(x, bounds.cy, cx, cy),
          ]);
        } else {
          // As an output.
          const x = bounds.x - MIN_SEGMENT;
          connect(entity, [
            segment(bounds.x, bounds.cy, x, bounds.cy),
            segment(x, bounds.cy, cx, cy),
          ]);
        }
      }
    }
}

/**
 * createConnector(entity, segments): a connector with a copy of the list,
 * and for each of the entity's roles in turn, its stoichiometry (from the
 * segments as given) and its type.
 */
function connect(entity: EntityGlyph, segments: Segment[]) {
  const connector = newConnector(entity, [...segments]);
  for (const role of entity.roles) {
    connector.stoichiometry = stoichiometry(segments, role);
    setPointer(connector, connectorType(role.type));
  }
}

/** Double.compare: -0.0 before 0.0, NaN last. */
function compareDoubles(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1;
  if (a === 0 && b === 0)
    return Object.is(a, -0) === Object.is(b, -0) ? 0 : Object.is(a, -0) ? -1 : 1;
  return 0;
}

/**
 * The regulators below the reaction, left to right, each to its own point
 * on a quarter or half circle round the reaction's centre.
 */
function regulators(index: LayoutIndex, grid: Grid<Div>, reactionPosition: Point) {
  const below: EntityGlyph[] = [];
  for (let c = 0; c < grid.columns; c += 1)
    for (let r = reactionPosition.row + 1; r < grid.rows; r += 1) {
      const div = grid.get(r, c);
      if (div instanceof HorizontalLayout) below.push(...(div.glyphs as EntityGlyph[]));
    }
  const layout = grid.get(reactionPosition.row, reactionPosition.col) as HorizontalLayout;
  const reaction = layout.glyphs[0] as ReactionGlyph;
  const reactionBounds: Bounds = reaction.bounds;
  const ys = index.regulators.map((entity) => boundsOf(entity).y);
  const my = ys.length ? Math.min(...ys) : 0;
  const hRule = my - MIN_SEGMENT;
  const sectors = index.regulators.length + 1;
  below.sort((a, b) => compareDoubles(a.bounds.cx, b.bounds.cx));
  const left = !below.some((e) => e.bounds.mx > reactionBounds.x);
  const right = !below.some((e) => e.bounds.x < reactionBounds.mx);
  let startAngle = 0;
  let totalAngle = Math.PI;
  if (left) totalAngle = 0.5 * Math.PI;
  if (right) {
    startAngle = 0.5 * Math.PI;
    totalAngle = 0.5 * Math.PI;
  }
  const radius = reactionBounds.height / 2 + (REGULATOR_SIZE * sectors) / totalAngle;
  let i = 1;
  for (const entity of below) {
    const bounds = boundsOf(entity);
    const x = reactionBounds.cx - radius * Math.cos(((startAngle + totalAngle) * i) / sectors);
    const y = reactionBounds.cy + radius * Math.sin(((startAngle + totalAngle) * i) / sectors);
    connect(entity, [
      segment(bounds.cx, bounds.y, bounds.cx, hRule),
      segment(bounds.cx, hRule, x, y),
    ]);
    i += 1;
  }
}
