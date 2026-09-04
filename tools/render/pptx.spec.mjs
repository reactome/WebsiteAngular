/**
 * The package has to satisfy PowerPoint, and PowerPoint's response to a
 * malformed package is to offer to repair the file rather than to say what is
 * wrong. These assertions are the things that produce that dialog: a
 * relationship pointing at a part that is not there, a part with no declared
 * content type, or XML that does not parse.
 */
// @vitest-environment node
//
// The node environment is required, not a preference. Under jsdom the ambient
// TextEncoder returns a Uint8Array belonging to another realm, fflate's
// `instanceof Uint8Array` check on it fails, and zipSync then writes every part
// of the package as an empty directory -- so the exporter appears to produce a
// package with no content whatsoever. The render service runs in node, and this
// runs where the code runs.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { pptx } from './pptx.mjs';

/**
 * Whether the XML parses. jsdom is brought in by hand rather than by the
 * environment, for the reason above; it reports a failure as a <parsererror>
 * document rather than by throwing.
 */
const { DOMParser } = new JSDOM().window;
function parses(xml) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const error = parsed.querySelector('parsererror');
  return error ? error.textContent.trim() : true;
}

/** Resolve a relationship target the way the package format does. */
function resolveTarget(part, target) {
  const base = part.split('/').slice(0, -2); // drop "_rels/<name>.rels"
  const segments = [...base, ...target.split('/')];
  const out = [];
  for (const segment of segments) {
    if (segment === '..') out.pop();
    else if (segment !== '.' && segment !== '') out.push(segment);
  }
  return out.join('/');
}

function open(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const slide = () => strFromU8(files['ppt/slides/slide1.xml']);
  return {
    files,
    text: (name) => strFromU8(files[name]),
    slide,
    /**
     * The slide without the shape tree's own group properties, which carry an
     * `<a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` of their own. Geometry
     * assertions have to skip it: matching the first offset in the slide reads
     * the group instead of a shape, and a zero-by-zero group makes a test that
     * compares width against height pass whatever the shapes do.
     */
    drawn: () => slide().replace(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/, ''),
  };
}

/** The drawn shapes of a package, group properties removed. */
function drawnOf(buffer) {
  return open(buffer).drawn();
}

const NODE = {
  kind: 'node',
  id: 'n1',
  name: 'ATP',
  x: 100,
  y: 50,
  w: 60,
  h: 20,
  geom: 'rect',
  fill: 'rgb(255,255,153)',
  stroke: 'rgb(0,0,0)',
  strokeWidth: 0.5,
  label: 'ATP',
  fontSize: 8,
  fontColor: '#000000',
  bold: false,
  dashed: false,
};

const EDGE = {
  kind: 'edge',
  id: 'e1',
  name: 'connector',
  points: [
    { x: 10, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 20 },
  ],
  stroke: 'rgb(0,0,0)',
  strokeWidth: 1.2,
  closed: false,
  fill: null,
  dashed: false,
};

/** An arrowhead, which the page hands over as a closed, filled polygon. */
const ARROW = {
  kind: 'edge',
  id: 'e1-arrow',
  name: 'production triangle',
  points: [
    { x: 60, y: 20 },
    { x: 48, y: 26 },
    { x: 48, y: 14 },
  ],
  stroke: '001f25',
  strokeWidth: 0,
  closed: true,
  fill: '001f25',
  dashed: false,
};

const SHAPES = { x: 0, y: 0, width: 400, height: 200, shapes: [NODE, EDGE] };

/** A one-pixel PNG: enough to stand in for the fallback raster. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

const PICTURE = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>',
  png: PNG,
  width: 400,
  height: 200,
};

/**
 * A payload the render page actually produced, for the Intrinsic Pathway for
 * Apoptosis.
 *
 * Here because inventing the input is how the colour bug got through: the
 * shapes written by hand in this file spell colours `rgb(...)` and `#rrggbb`,
 * the page spells them as six bare hex digits, and an emitter that read only
 * the first two passed every test while filling nothing on any real slide.
 * Recapture with `window.__renderExport.shapes()` on /PathwayBrowser/render.
 */
const REAL = JSON.parse(
  readFileSync(new URL('./fixtures/shapes-apoptosis.json', import.meta.url), 'utf8')
);

describe.each([
  ['shapes', () => pptx({ title: 'Glycolysis', shapes: SHAPES })],
  ['real shapes', () => pptx({ title: 'Intrinsic Pathway for Apoptosis', shapes: REAL })],
  ['picture', () => pptx({ title: 'Glycolysis', ...PICTURE })],
  ['picture with no raster', () => pptx({ title: 'Glycolysis', ...PICTURE, png: null })],
])('a %s package', (_kind, build) => {
  it('declares a content type for every part', () => {
    const { files, text } = open(build());
    const types = text('[Content_Types].xml');
    const defaults = new Set(
      [...types.matchAll(/<Default Extension="([^"]+)"/g)].map((match) => match[1].toLowerCase())
    );
    const overrides = new Set(
      [...types.matchAll(/<Override PartName="([^"]+)"/g)].map((match) => match[1])
    );

    for (const part of Object.keys(files)) {
      if (part === '[Content_Types].xml') continue;
      const extension = part.split('.').pop().toLowerCase();
      expect(
        overrides.has(`/${part}`) || defaults.has(extension),
        `${part} has no content type`
      ).toBe(true);
    }
  });

  it('points every relationship at a part that exists', () => {
    const { files, text } = open(build());
    const relParts = Object.keys(files).filter((part) => part.endsWith('.rels'));
    expect(relParts.length).toBeGreaterThan(0);

    for (const part of relParts) {
      for (const match of text(part).matchAll(/Target="([^"]+)"/g)) {
        const resolved = resolveTarget(part, match[1]);
        expect(files[resolved], `${part} -> ${match[1]} (${resolved})`).toBeDefined();
      }
    }
  });

  it('writes XML that parses', () => {
    const { files, text } = open(build());
    for (const part of Object.keys(files)) {
      if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
      expect(parses(text(part)), part).toBe(true);
    }
  });

  it('gives every shape in the tree a distinct id', () => {
    const ids = [
      ...open(build())
        .slide()
        .matchAll(/<p:cNvPr id="(\d+)"/g),
    ].map((match) => match[1]);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids).not.toContain('0');
  });
});

describe('a slide built from shapes', () => {
  it('draws a shape per shape and no picture', () => {
    const slide = open(pptx({ title: 'Glycolysis', shapes: SHAPES })).slide();
    // Two shapes plus the title.
    expect((slide.match(/<p:sp>/g) ?? []).length).toBe(3);
    expect(slide).not.toContain('<p:pic>');
  });

  it('carries no image parts, having no picture to carry', () => {
    const { files } = open(pptx({ title: 'Glycolysis', shapes: SHAPES }));
    expect(Object.keys(files).filter((part) => part.startsWith('ppt/media/'))).toEqual([]);
  });

  it('routes an edge through its bend points rather than straight', () => {
    const slide = open(pptx({ shapes: { ...SHAPES, shapes: [EDGE] } })).slide();
    expect(slide).toContain('<a:custGeom>');
    expect((slide.match(/<a:lnTo>/g) ?? []).length).toBe(EDGE.points.length - 1);
    expect((slide.match(/<a:moveTo>/g) ?? []).length).toBe(1);
  });

  it('closes and fills an arrowhead, and leaves a connector open', () => {
    // OOXML line ends are always filled and always the line's own colour, so an
    // arrowhead drawn as one cannot be hollow, cannot be a bar, and cannot be
    // green. The page sends geometry instead; this is the shape of that.
    const head = open(pptx({ shapes: { ...SHAPES, shapes: [ARROW] } })).slide();
    expect(head).toContain('<a:close/>');
    expect(head).toContain('<a:srgbClr val="001F25">');
    expect(head, 'a filled head draws no outline of its own').toContain('<a:ln><a:noFill/></a:ln>');

    const line = open(pptx({ shapes: { ...SHAPES, shapes: [EDGE] } })).slide();
    expect(line).not.toContain('<a:close/>');
    expect(line).toContain('<a:noFill/>');
  });

  it('leaves a hollow arrowhead unfilled and outlined', () => {
    const slide = open(
      pptx({
        shapes: {
          ...SHAPES,
          shapes: [{ ...ARROW, fill: null, stroke: '0c9509', strokeWidth: 2 }],
        },
      })
    ).slide();
    expect(slide).toContain('<a:close/>');
    expect(slide).toContain('<a:noFill/>');
    expect(slide, 'the outline carries the arrowhead colour').toContain('<a:srgbClr val="0C9509">');
  });

  it('never spells an arrowhead as a line end', () => {
    // A line end would be the obvious way to draw one and cannot say what the
    // diagram says: a tee has no line end at all.
    const slide = open(pptx({ shapes: REAL })).slide();
    expect(slide).not.toContain('tailEnd');
    expect(slide).not.toContain('headEnd');
  });

  it('keeps the diagram square, mapping both axes by one scale', () => {
    const slide = drawnOf(
      pptx({
        shapes: {
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          shapes: [{ ...NODE, x: 0, y: 0, w: 100, h: 100 }],
        },
      })
    );
    const [, cx, cy] = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(slide);
    expect(Number(cx)).toBe(Number(cy));
  });

  it('places a shape where the diagram puts it, relative to the extent', () => {
    // A shape at the extent's own origin belongs at the picture's top-left, and
    // one at the far corner at its bottom-right.
    const at = (shape) => {
      const slide = drawnOf(
        pptx({ shapes: { x: 100, y: 100, width: 400, height: 200, shapes: [shape] } })
      );
      const [, x, y, cx, cy] =
        /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(slide);
      return { x: Number(x), y: Number(y), cx: Number(cx), cy: Number(cy) };
    };
    const first = at({ ...NODE, x: 100, y: 100, w: 40, h: 20 });
    const last = at({ ...NODE, x: 460, y: 280, w: 40, h: 20 });
    expect(last.x).toBeGreaterThan(first.x);
    expect(last.y).toBeGreaterThan(first.y);
    // Same size in the diagram, so the same size on the slide.
    expect(last.cx).toBe(first.cx);
    expect(last.cy).toBe(first.cy);
  });

  it('never emits a zero-sided shape, which PowerPoint handles badly', () => {
    const slide = drawnOf(
      pptx({
        shapes: {
          ...SHAPES,
          // A horizontal connector: no height at all in diagram coordinates.
          shapes: [
            {
              ...EDGE,
              points: [
                { x: 10, y: 50 },
                { x: 200, y: 50 },
              ],
            },
          ],
        },
      })
    );
    for (const match of slide.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"\/>/g)) {
      expect(Number(match[1])).toBeGreaterThan(0);
      expect(Number(match[2])).toBeGreaterThan(0);
    }
  });

  it('drops an edge that has fewer than two usable points', () => {
    const slide = open(
      pptx({ shapes: { ...SHAPES, shapes: [{ ...EDGE, points: [{ x: 1, y: 1 }] }] } })
    ).slide();
    expect(slide).not.toContain('<a:custGeom>');
  });

  it('falls back to the picture when the view has no shapes', () => {
    for (const shapes of [null, { x: 0, y: 0, width: 1, height: 1, shapes: [] }]) {
      const { files, slide } = open(pptx({ ...PICTURE, shapes }));
      expect(slide()).toContain('<p:pic>');
      expect(files['ppt/media/image1.svg']).toBeDefined();
    }
  });

  it('renders a colour with transparency as a real alpha', () => {
    const slide = open(
      pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, fill: 'rgba(255,255,153,0.5)' }] } })
    ).slide();
    expect(slide).toContain('<a:alpha val="50000"/>');
  });

  it('leaves an unpaintable colour unfilled rather than painting it black', () => {
    for (const fill of [null, 'none', 'transparent', 'rebeccapurple-ish']) {
      const slide = open(pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, fill }] } })).slide();
      expect(slide, String(fill)).toContain('<a:noFill/>');
    }
  });

  it('reads the colour spellings cytoscape actually hands back', () => {
    const cases = [
      ['rgb(255,255,153)', 'FFFF99'],
      ['rgb(255, 255, 153)', 'FFFF99'],
      ['#ffff99', 'FFFF99'],
      ['#ff9', 'FFFF99'],
    ];
    for (const [fill, hex] of cases) {
      const slide = open(pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, fill }] } })).slide();
      expect(slide, fill).toContain(`<a:srgbClr val="${hex}">`);
    }
  });

  it('escapes a label that would otherwise break the XML', () => {
    const label = 'PI(3,4)P2 <&> "x"';
    const slide = open(
      pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, label, name: label }] } })
    ).slide();
    expect(parses(slide)).toBe(true);
    expect(slide).toContain('PI(3,4)P2 &lt;&amp;&gt; &quot;x&quot;');
  });

  it('keeps a label PowerPoint would reject as too small at its minimum', () => {
    const slide = open(
      pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, label: 'ATP', fontSize: 0.01 }] } })
    ).slide();
    const sizes = [...slide.matchAll(/ sz="(\d+)"/g)].map((match) => Number(match[1]));
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(100);
  });

  it('never lets a label resize the glyph it names', () => {
    // OOXML spells these `spAutoFit`, `normAutofit` and `noAutofit` -- one with
    // a capital F and two without, so a case-sensitive search for the wrong one
    // reports a clean result. Match all three.
    const slide = open(pptx({ shapes: REAL })).slide();
    const autofits = [...slide.matchAll(/<a:(spAutoFit|normAutofit|noAutofit)\s*\/>/g)].map(
      (match) => match[1]
    );
    expect(autofits.length).toBeGreaterThan(100);
    expect(new Set(autofits)).toEqual(new Set(['noAutofit']));
  });

  it('writes no text run for an unlabelled shape', () => {
    const slide = open(pptx({ shapes: { ...SHAPES, shapes: [{ ...NODE, label: '' }] } })).slide();
    expect(slide).not.toContain('<a:t>');
  });
});

describe('a slide built from a payload the page produced', () => {
  it('draws every shape the page described', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    expect(REAL.shapes.length).toBeGreaterThan(400);
    expect((slide.match(/<p:sp>/g) ?? []).length).toBe(REAL.shapes.length);
    expect(slide).not.toContain('<p:pic>');
  });

  it('fills every shape the page gave a colour', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    const coloured = REAL.shapes.filter((shape) => shape.kind === 'node' && shape.fill);
    expect(coloured.length).toBeGreaterThan(100);
    // Every distinct colour in the payload has to appear in the slide, with its
    // alpha where it has one. This is the assertion the invented-input tests
    // could not make.
    for (const fill of new Set(coloured.map((shape) => shape.fill))) {
      const [, hex, alpha] = /^([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(fill);
      expect(slide, fill).toContain(`<a:srgbClr val="${hex.toUpperCase()}">`);
      if (alpha !== undefined) {
        const permille = Math.round((parseInt(alpha, 16) / 255) * 100000);
        expect(slide, fill).toContain(`<a:alpha val="${permille}"/>`);
      }
    }
    // And nothing the page coloured may come out unfilled. An outline can be
    // noFill too, so strip the outlines first: what is left is one body fill
    // per shape, empty exactly where the page sent no colour.
    const bodies = slide.replace(/<a:ln[ >][\s\S]*?<\/a:ln>/g, '');
    const unfilled = REAL.shapes.filter((shape) => !shape.fill).length;
    expect((bodies.match(/<a:noFill\/>/g) ?? []).length).toBe(unfilled);
  });

  it('keeps every label the page gave it, escaped', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    const labelled = REAL.shapes.filter((shape) => shape.kind === 'node' && shape.label);
    expect(labelled.length).toBeGreaterThan(100);
    expect((slide.match(/<a:t>/g) ?? []).length).toBe(labelled.length);
    expect(parses(slide)).toBe(true);
  });

  it('routes the connectors that have bends through them', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    const bent = REAL.shapes.filter((shape) => shape.kind === 'edge' && shape.points.length > 2);
    expect(bent.length).toBeGreaterThan(50);
    const segments = REAL.shapes
      .filter((shape) => shape.kind === 'edge')
      .reduce((total, edge) => total + edge.points.length - 1, 0);
    expect((slide.match(/<a:lnTo>/g) ?? []).length).toBe(segments);
  });

  it('names every geometry the diagram uses as a preset OOXML has', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    for (const geom of new Set(
      REAL.shapes.filter((shape) => shape.kind === 'node').map((shape) => shape.geom)
    )) {
      expect(['roundRect', 'rect', 'ellipse'], geom).toContain(geom);
      expect(slide).toContain(`<a:prstGeom prst="${geom}">`);
    }
  });

  it('stays a size a person can email', () => {
    // The picture version of this diagram was around 1.5MB of SVG.
    expect(pptx({ shapes: REAL }).length).toBeLessThan(400_000);
  });
});

describe('a picture slide with no raster', () => {
  it('embeds the SVG as the picture rather than naming a missing part', () => {
    const { files, slide } = open(pptx({ ...PICTURE, png: null }));
    expect(files['ppt/media/image1.png']).toBeUndefined();
    expect(files['ppt/media/image1.svg']).toBeDefined();
    expect(slide()).toContain('<a:blip r:embed="rId3"/>');
    expect(slide()).not.toContain('svgBlip');
  });
});

describe('the slide itself', () => {
  const slideSize = (buffer) => {
    const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(
      open(buffer).text('ppt/presentation.xml')
    );
    return { cx: Number(cx), cy: Number(cy) };
  };
  const INCH = 914400;
  /** The 0.3in margin the slide keeps around the diagram, both sides. */
  const MARGINS = 2 * 274638;

  it('is the size of the diagram, as the exporter it replaces does it', () => {
    // 400 by 200 diagram pixels at 96dpi. The margin is a constant, so it is
    // the drawn area that has the diagram's proportions, not the whole slide.
    const { cx, cy } = slideSize(pptx({ shapes: SHAPES }));
    expect((cx - MARGINS) / (cy - MARGINS)).toBeCloseTo(400 / 200, 1);
    expect(cx - MARGINS).toBe(400 * 9525);
    expect(cy - MARGINS).toBe(200 * 9525);
  });

  it('never asks for a slide larger than PowerPoint allows', () => {
    // The real diagram is 5976px, which is 62in at its own size.
    const { cx, cy } = slideSize(pptx({ shapes: REAL }));
    expect(cx).toBeLessThanOrEqual(56 * INCH);
    expect(cy).toBeLessThanOrEqual(56 * INCH);
    expect(cx).toBeGreaterThan(50 * INCH);
    // Still the diagram's shape, not clipped to a square.
    expect(cx / cy).toBeCloseTo(REAL.width / REAL.height, 1);
  });

  it('never asks for a slide smaller than PowerPoint allows', () => {
    const { cx, cy } = slideSize(
      pptx({ shapes: { x: 0, y: 0, width: 4, height: 3, shapes: [NODE] } })
    );
    expect(cx).toBeGreaterThanOrEqual(INCH);
    expect(cy).toBeGreaterThanOrEqual(INCH);
  });

  it('keeps labels at a size a person can read', () => {
    // Production's own slide for this diagram uses 6, 8 and 10pt. Fitting the
    // diagram onto a 13.3in slide instead gave 1.65pt.
    const slide = open(pptx({ shapes: REAL })).slide();
    const sizes = [...slide.matchAll(/ sz="(\d+)"/g)].map((match) => Number(match[1]));
    const labels = sizes.filter((size) => size !== 1800); // not the title
    expect(Math.min(...labels)).toBeGreaterThanOrEqual(400);
  });

  it('sizes the slide to the picture on the fallback path too', () => {
    const { cx, cy } = slideSize(pptx({ ...PICTURE }));
    expect((cx - MARGINS) / (cy - MARGINS)).toBeCloseTo(400 / 200, 1);
  });
});

describe('a payload framed on one event', () => {
  /**
   * The same diagram asked for one reaction, which is what `?select=` does.
   *
   * Here because framing is where the contract "every shape lies inside the
   * extent" is easy to break and impossible to notice: an SVG has a viewBox and
   * simply does not draw what falls outside, so the same payload looks right in
   * one format and puts objects 31 inches off the side of the slide in another.
   */
  const FRAMED = JSON.parse(
    readFileSync(new URL('./fixtures/shapes-framed-reaction.json', import.meta.url), 'utf8')
  );

  it('is a frame, not the whole diagram', () => {
    expect(FRAMED.shapes.length).toBeLessThan(REAL.shapes.length / 4);
    expect(FRAMED.width).toBeLessThan(REAL.width / 2);
  });

  it.each([
    ['framed', () => FRAMED],
    ['whole', () => REAL],
  ])('keeps every %s shape inside the extent it declares', (_name, payload) => {
    const page = payload();
    const right = page.x + page.width;
    const bottom = page.y + page.height;
    // A hair of tolerance: the extent and the geometry are both floats.
    const slack = 0.5;
    for (const shape of page.shapes) {
      const points =
        shape.kind === 'edge'
          ? shape.points
          : [
              { x: shape.x, y: shape.y },
              { x: shape.x + shape.w, y: shape.y + shape.h },
            ];
      for (const point of points) {
        expect(point.x, `${shape.name} x`).toBeGreaterThanOrEqual(page.x - slack);
        expect(point.x, `${shape.name} x`).toBeLessThanOrEqual(right + slack);
        expect(point.y, `${shape.name} y`).toBeGreaterThanOrEqual(page.y - slack);
        expect(point.y, `${shape.name} y`).toBeLessThanOrEqual(bottom + slack);
      }
    }
  });

  it('puts no shape past the edge of the slide it is drawn on', () => {
    const { files, drawn } = open(pptx({ title: 'Framed', shapes: FRAMED }));
    const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(
      strFromU8(files['ppt/presentation.xml'])
    );
    const placed = [
      ...drawn().matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g),
    ];
    expect(placed.length).toBeGreaterThan(10);
    for (const [, x, y, w, h] of placed) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(x) + Number(w)).toBeLessThanOrEqual(Number(cx));
      expect(Number(y) + Number(h)).toBeLessThanOrEqual(Number(cy));
    }
  });
});

describe('the tints the diagram paints behind its glyphs', () => {
  it('draws every underlay the page described', () => {
    const underlays = REAL.shapes.filter((shape) => shape.name.endsWith('highlight'));
    // The sub-pathway tints: reading line-color alone lost all of them.
    expect(underlays.length).toBeGreaterThan(150);
    const colours = new Set(
      underlays.map((shape) => (shape.kind === 'edge' ? shape.stroke : shape.fill))
    );
    expect(colours.size).toBeGreaterThan(3);
    const slide = open(pptx({ shapes: REAL })).slide();
    for (const colour of colours) {
      expect(slide, colour).toContain(`<a:srgbClr val="${colour.slice(0, 6).toUpperCase()}">`);
    }
  });

  it('puts each underlay behind the glyphs it sits under', () => {
    // The page hands them over in draw order, and OOXML paints in document
    // order, so an underlay emitted after its glyph would hide it.
    const names = REAL.shapes.map((shape) => shape.name);
    const lastUnderlay = names.reduce(
      (last, name, at) => (name.endsWith('highlight') ? at : last),
      -1
    );
    const entities = REAL.shapes.filter((shape) => shape.kind === 'node' && shape.label);
    const firstLabelled = REAL.shapes.indexOf(entities.at(-1));
    expect(lastUnderlay).toBeLessThan(firstLabelled);
  });

  it('keeps a translucent tint translucent', () => {
    const slide = open(pptx({ shapes: REAL })).slide();
    const alphas = [...slide.matchAll(/<a:alpha val="(\d+)"\/>/g)].map((match) => Number(match[1]));
    expect(alphas.length).toBeGreaterThan(150);
    for (const alpha of alphas) expect(alpha).toBeLessThan(100000);
  });

  it('draws a broken line where the diagram draws one', () => {
    const dashed = REAL.shapes.filter((shape) => shape.dashed);
    expect(dashed.length).toBeGreaterThan(0);
    const slide = open(pptx({ shapes: REAL })).slide();
    expect((slide.match(/<a:prstDash val="dash"\/>/g) ?? []).length).toBe(dashed.length);
  });

  it('puts the dash before the join, as the schema wants', () => {
    const slide = open(
      pptx({ shapes: { ...SHAPES, shapes: [{ ...EDGE, dashed: true }] } })
    ).slide();
    expect(slide).toContain('<a:prstDash val="dash"/><a:round/>');
  });
});
