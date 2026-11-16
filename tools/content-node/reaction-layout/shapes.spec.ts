// @vitest-environment node
//
// Step 3 of the reaction layout (research D22): a connector's end shape, as
// diagram-reader's ConnectorImpl.setPointer draws it. Every expected value
// was printed by the deployed jar's own classes, run under the JDK 11 the
// service runs on, on these invented segments: the arithmetic must agree to
// the last bit.
import { describe, expect, it } from 'vitest';
import { setPointer } from './shapes.ts';
import type { Connector, ConnectorType } from './shapes.ts';

/** A connector with a segment per four numbers: x1, y1, x2, y2. */
function connector(...xy: number[]): Connector {
  const segments = [];
  for (let i = 0; i < xy.length; i += 4)
    segments.push({
      from: { x: xy[i] as number, y: xy[i + 1] as number },
      to: { x: xy[i + 2] as number, y: xy[i + 3] as number },
    });
  return { segments };
}

const points = (k: Connector) => k.segments.map(({ from, to }) => [from.x, from.y, to.x, to.y]);

function pointed(type: ConnectorType, ...xy: number[]): Connector {
  const k = connector(...xy);
  setPointer(k, type);
  return k;
}

describe("a connector's end", () => {
  it("is an arrow at the first segment's start for an output", () => {
    const k = pointed('OUTPUT', 478.5, 160.25, 397, 140.75, 397, 140.75, 322, 156);
    expect(k.endShape).toEqual({
      a: { x: 470.83119549071705, y: 162.52803366928626 },
      b: { x: 478.5, y: 160.25 },
      c: { x: 472.69276271708037, y: 154.74763731294746 },
      type: 'ARROW',
      empty: false,
    });
    expect(points(k)).toEqual([
      [478.5, 160.25, 397, 140.75],
      [397, 140.75, 322, 156],
    ]);
  });

  it('is a circle short of the reaction for a catalyst, the last segment shortened', () => {
    const k = pointed('CATALYST', 296.5, 60, 296.5, 110, 296.5, 110, 301.25, 141.5);
    expect(k.endShape).toEqual({
      c: { x: 299.4607049863334, y: 129.63414885673734 },
      r: 4,
      type: 'CIRCLE',
      empty: true,
    });
    expect(points(k)[1]).toEqual([296.5, 110, 298.8642733151112, 125.67886514231645]);
  });

  it('is shortened again when a catalyst is set twice, as an entity with two roles is', () => {
    const k = pointed('CATALYST', 296.5, 60, 296.5, 110, 296.5, 110, 301.25, 141.5);
    setPointer(k, 'CATALYST');
    expect(k.endShape?.c).toEqual({ x: 297.0749783014446, y: 113.8130139990538 });
    expect(points(k)[1]).toEqual([296.5, 110, 296.4785466302224, 109.8577302846329]);
  });

  it('is a bar across the shortened end for an inhibitor', () => {
    const k = pointed('INHIBITOR', 100, 300.5, 100, 250, 100, 250, 290.75, 160.125);
    expect(k.endShape).toEqual({
      a: { x: 280.90354539731953, y: 160.34255862969198 },
      b: { x: 284.31334713570715, y: 167.5794952816801 },
      c: { x: 282.60844626651334, y: 163.96102695568604 },
      type: 'STOP',
    });
    expect(points(k)[1]).toEqual([100, 250, 282.60844626651334, 163.96102695568604]);
  });

  it('is a bar on a vertical and a horizontal line too', () => {
    expect(pointed('INHIBITOR', 50, 10, 50, 90).endShape).toEqual({
      a: { x: 46, y: 81 },
      b: { x: 54, y: 81 },
      c: { x: 50, y: 81 },
      type: 'STOP',
    });
    expect(pointed('INHIBITOR', 10, 50, 90, 50).endShape).toEqual({
      a: { x: 81, y: 54 },
      b: { x: 81, y: 46 },
      c: { x: 81, y: 50 },
      type: 'STOP',
    });
    // Leftward: a horizontal line is a right angle, whichever way it runs.
    expect(pointed('INHIBITOR', 90, 50, 10, 50).endShape).toEqual({
      a: { x: 19, y: 54 },
      b: { x: 19, y: 46 },
      c: { x: 19, y: 50 },
      type: 'STOP',
    });
  });

  it("is an open arrow at the last segment's end for an activator, nothing for an input", () => {
    const k = pointed('ACTIVATOR', 100, 300.5, 100, 250, 100, 250, 290.75, 160.125);
    expect(k.endShape).toEqual({
      a: { x: 286.1875298829934, y: 166.69644325330606 },
      b: { x: 290.75, y: 160.125 },
      c: { x: 282.7777281446058, y: 159.45950660131794 },
      type: 'ARROW',
      empty: true,
    });
    expect(pointed('INPUT', 1, 2, 3, 4).endShape).toBeUndefined();
  });
});
