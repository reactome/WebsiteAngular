/**
 * PowerPoint of a rendered diagram.
 *
 * The slide is built out of shapes: one per compartment, connector and entity,
 * editable the moment the file opens. Curators reported that "the whole pathway
 * diagram is treated as a single item" when the slide held a single picture,
 * and being able to take a diagram apart on a slide is the point of the format.
 *
 * That means a second renderer -- this one -- describing the same diagram in
 * DrawingML that the page describes in SVG, which is the drift this work exists
 * to remove elsewhere. It is narrower than it looks: the page decides every
 * position, colour and font from the live style and hands them over as
 * `RenderShapes`, so what lives here is the OOXML spelling of a rectangle, and
 * not a second opinion about what the diagram looks like.
 *
 * Views that are not made of shapes -- an illustration is artwork, the
 * genome-wide view draws to a canvas -- have no shapes to emit, and those fall
 * back to the earlier behaviour: the SVG as a picture for PowerPoint to draw,
 * with a PNG beside it for anything that cannot.
 *
 * Two things a shape slide does not carry yet. The style draws node decorations
 * with `background-image`, which are 140 small rasters on an average diagram, so
 * a complex loses the band marking it as one; and edges with weights are routed
 * `round-segments`, which this draws through the same points with square
 * corners. Both are additions to `RenderShapes` rather than changes here.
 *
 * A .pptx is a zip of XML parts. The parts here are the smallest set PowerPoint
 * will open: a presentation, one master, one layout, one slide, and a theme.
 * Nothing is optional -- a missing theme or an unresolved relationship is what
 * makes PowerPoint offer to repair a file.
 */
import { zipSync, strToU8 } from 'fflate';

/** English Metric Units per pixel at 96dpi, the unit all OOXML geometry uses. */
const EMU_PER_PX = 9525;
const MARGIN = 274638; // 0.3in
const TITLE_HEIGHT = 461665; // 0.5in

/**
 * The slide is the size of the diagram, which is how the exporter this replaces
 * does it: production's slide for the Intrinsic Pathway for Apoptosis is 41.9in
 * by 23.6in with labels at 6, 8 and 10pt.
 *
 * Fitting a diagram onto a 13.3in slide instead is what a picture wants, and
 * ruins a slide of shapes -- the same diagram came out scaled to a fifth, with
 * every label at 1.65pt. Shapes are worth having because a person can read and
 * move them, and neither survives that.
 *
 * PowerPoint's slide is at most 56in on a side, so a diagram wider than that at
 * its own size is scaled to fit rather than clipped. Apoptosis is 5976px, which
 * is 62in, so this is the ordinary case rather than the exotic one.
 */
const MAX_SLIDE = 51206400; // 56in, the largest PowerPoint accepts
const MIN_SLIDE = 914400; // 1in, the smallest

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  od: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

/** The extension that carries an SVG alongside a raster blip. */
const SVG_BLIP_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function escapeXml(text) {
  return String(text).replace(
    /[<>&'"]/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]
  );
}

function relationships(entries) {
  return (
    DECLARATION +
    `<Relationships xmlns="${NS.pr}">` +
    entries
      .map(
        ({ id, type, target }) =>
          `<Relationship Id="${id}" Type="${NS.od}/${type}" Target="${target}"/>`
      )
      .join('') +
    `</Relationships>`
  );
}

/**
 * The slide, and where the diagram sits on it.
 *
 * One scale for both axes -- a stretched pathway is a wrong pathway, and every
 * glyph in it carries meaning in its proportions -- and that scale is 1:1 unless
 * the diagram is larger than a slide can be.
 */
function layout({ width, height, hasTitle }) {
  const titleHeight = hasTitle ? TITLE_HEIGHT : 0;
  const room = MAX_SLIDE - 2 * MARGIN;
  const emuPerPx = Math.min(
    EMU_PER_PX,
    width > 0 ? room / width : EMU_PER_PX,
    height > 0 ? (room - titleHeight) / height : EMU_PER_PX
  );

  const drawn = {
    cx: Math.max(1, Math.round(width * emuPerPx)),
    cy: Math.max(1, Math.round(height * emuPerPx)),
  };
  const slide = {
    cx: Math.min(MAX_SLIDE, Math.max(MIN_SLIDE, drawn.cx + 2 * MARGIN)),
    cy: Math.min(MAX_SLIDE, Math.max(MIN_SLIDE, drawn.cy + 2 * MARGIN + titleHeight)),
  };

  return {
    slide,
    emuPerPx,
    // Centred, which only shows on a diagram small enough to have been pushed
    // out to the one-inch minimum.
    at: {
      x: Math.round((slide.cx - drawn.cx) / 2),
      y: Math.round(titleHeight + (slide.cy - titleHeight - drawn.cy) / 2),
      ...drawn,
    },
  };
}

function titleShape(title, slide) {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${MARGIN}" y="${MARGIN}"/>` +
    `<a:ext cx="${slide.cx - 2 * MARGIN}" cy="${TITLE_HEIGHT}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>` +
    `<a:r><a:rPr lang="en-US" sz="1800" b="1" dirty="0"/><a:t>${escapeXml(title)}</a:t></a:r>` +
    `</a:p></p:txBody></p:sp>`
  );
}

/**
 * A colour as OOXML wants it: six hex digits, with alpha separate.
 *
 * `RenderShapes` sends six bare hex digits, which is the case that matters --
 * an earlier version of this read only `#rrggbb` and `rgb()`, so every shape on
 * every slide would have come out unfilled while its unit tests, fed colours
 * written here rather than colours from the page, passed. The other spellings
 * are kept because they cost two regexes and remove a way for that to happen
 * again.
 *
 * Anything unrecognised returns null, and a null fill is a shape with no fill
 * rather than a shape painted black.
 */
function srgb(colour) {
  if (!colour) return null;
  const text = String(colour).trim();
  if (text === 'none' || text === 'transparent') return null;

  // Six digits opaque, eight with alpha: the form `RenderShapes` sends.
  const bare = /^([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text);
  if (bare) {
    return {
      hex: bare[1].toUpperCase(),
      alpha: bare[2] === undefined ? 1 : parseInt(bare[2], 16) / 255,
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
    text
  );
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map((value) => clampByte(Number(value)));
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return { hex: hex6(r, g, b), alpha: Number.isFinite(alpha) ? alpha : 1 };
  }

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) {
    const [r, g, b] = short.slice(1, 4).map((digit) => parseInt(digit + digit, 16));
    return { hex: hex6(r, g, b), alpha: 1 };
  }

  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text);
  if (long) {
    return {
      hex: long[1].toUpperCase(),
      alpha: long[2] === undefined ? 1 : parseInt(long[2], 16) / 255,
    };
  }

  return null;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

function hex6(r, g, b) {
  return [r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** A solid fill, or nothing at all -- alpha below 1 becomes a real alpha. */
function solidFill(colour) {
  const parsed = srgb(colour);
  if (!parsed) return '<a:noFill/>';
  return (
    `<a:solidFill><a:srgbClr val="${parsed.hex}">` +
    (parsed.alpha < 1 ? `<a:alpha val="${Math.round(parsed.alpha * 100000)}"/>` : '') +
    `</a:srgbClr></a:solidFill>`
  );
}

/**
 * An outline.
 *
 * OOXML line widths are EMU, and a hairline is `w="0"` rather than a missing
 * width, so a sub-pixel border stays visible instead of vanishing.
 */
function outline(colour, widthPx, emuPerPx, { dashed = false, extra = '' } = {}) {
  const parsed = srgb(colour);
  if (!parsed) return '<a:ln><a:noFill/></a:ln>';
  const w = Math.max(0, Math.round(widthPx * emuPerPx));
  return (
    `<a:ln w="${w}" cap="rnd">` +
    `<a:solidFill><a:srgbClr val="${parsed.hex}">` +
    (parsed.alpha < 1 ? `<a:alpha val="${Math.round(parsed.alpha * 100000)}"/>` : '') +
    `</a:srgbClr></a:solidFill>` +
    // Order matters here: the schema wants the fill, then the dash, then the
    // join, then the ends.
    (dashed ? '<a:prstDash val="dash"/>' : '') +
    `<a:round/>${extra}</a:ln>`
  );
}

/**
 * The text inside a shape.
 *
 * `sz` is hundredths of a point, and PowerPoint refuses anything under 1pt, so
 * a label scaled down to nothing is clamped rather than dropped.
 *
 * Autofit is off, and has to be spelled out: the box is the glyph's box, and
 * `spAutoFit` -- which is what this said first -- resizes the shape to fit its
 * text, so a long name would have grown its entity and moved it off its own
 * connectors.
 */
function textBody({ label, fontSize, fontColor, bold, emuPerPx }) {
  const body =
    `<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr">` +
    `<a:noAutofit/></a:bodyPr><a:lstStyle/>`;
  if (!label) return `<p:txBody>${body}<a:p/></p:txBody>`;

  const points = Math.max(100, Math.round(fontSize * 0.75 * (emuPerPx / EMU_PER_PX) * 100));
  const colour = srgb(fontColor);
  return (
    `<p:txBody>${body}<a:p><a:pPr algn="ctr"/><a:r>` +
    `<a:rPr lang="en-US" sz="${points}"${bold ? ' b="1"' : ''} dirty="0">` +
    (colour
      ? `<a:solidFill><a:srgbClr val="${colour.hex}">` +
        (colour.alpha < 1 ? `<a:alpha val="${Math.round(colour.alpha * 100000)}"/>` : '') +
        `</a:srgbClr></a:solidFill>`
      : '') +
    `</a:rPr><a:t>${escapeXml(label)}</a:t></a:r></a:p></p:txBody>`
  );
}

/** A node: a preset rectangle, rounded rectangle or ellipse, with its label. */
function nodeShape(shape, id, place, emuPerPx) {
  const at = place(shape.x, shape.y, shape.w, shape.h);
  const stroke =
    shape.strokeWidth > 0 || !shape.fill
      ? outline(shape.stroke, shape.strokeWidth, emuPerPx, { dashed: Boolean(shape.dashed) })
      : '<a:ln><a:noFill/></a:ln>';
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(shape.name || shape.id)}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${at.x}" y="${at.y}"/><a:ext cx="${at.cx}" cy="${at.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="${shape.geom}"><a:avLst/></a:prstGeom>` +
    solidFill(shape.fill) +
    stroke +
    `</p:spPr>` +
    textBody({ ...shape, emuPerPx }) +
    `</p:sp>`
  );
}

/**
 * An edge: a free-form path through its bend points.
 *
 * A preset line only joins two points, and the diagram's routing is orthogonal
 * -- exporting these as straight lines put connectors through the middle of
 * entities they were routed around. A custom geometry takes the whole polyline.
 * Its coordinates are relative to the shape's own box, so the box is the
 * polyline's bounds; a perfectly straight run gives that box a zero side, which
 * is legal but which PowerPoint handles badly, so both sides have a floor.
 */
function edgeShape(shape, id, place, emuPerPx) {
  // Closed and filled means an arrowhead; the page hands those over as points
  // for the same reason it hands over everything else.
  const points = (shape.points ?? []).filter(
    (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (points.length < 2) return '';

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys) };
  const at = place(box.x, box.y, Math.max(...xs) - box.x, Math.max(...ys) - box.y);
  const cx = Math.max(1, at.cx);
  const cy = Math.max(1, at.cy);

  const path =
    points
      .map((point, index) => {
        const x = Math.round((point.x - box.x) * emuPerPx);
        const y = Math.round((point.y - box.y) * emuPerPx);
        const pt = `<a:pt x="${x}" y="${y}"/>`;
        return index === 0 ? `<a:moveTo>${pt}</a:moveTo>` : `<a:lnTo>${pt}</a:lnTo>`;
      })
      .join('') + (shape.closed ? '<a:close/>' : '');

  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(shape.name || shape.id)}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${at.x}" y="${at.y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>` +
    `<a:rect l="0" t="0" r="r" b="b"/><a:pathLst>` +
    `<a:path w="${cx}" h="${cy}">${path}</a:path>` +
    `</a:pathLst></a:custGeom>` +
    solidFill(shape.fill) +
    // A filled arrowhead has no outline to draw; giving it one at width 0 makes
    // PowerPoint draw a hairline, which on a small head is most of the head.
    (shape.strokeWidth > 0 || !shape.fill
      ? outline(shape.stroke, shape.strokeWidth, emuPerPx, { dashed: Boolean(shape.dashed) })
      : '<a:ln><a:noFill/></a:ln>') +
    `</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`
  );
}

/**
 * The slide, drawn as shapes.
 *
 * Every coordinate is mapped through the same fit the picture used, so a shape
 * slide and a picture slide put the diagram in the same place at the same size.
 */
function shapesSlideXml({ title, shapes, at, emuPerPx, slide }) {
  const place = (x, y, w, h) => ({
    x: Math.round(at.x + (x - shapes.x) * emuPerPx),
    y: Math.round(at.y + (y - shapes.y) * emuPerPx),
    cx: Math.max(1, Math.round(w * emuPerPx)),
    cy: Math.max(1, Math.round(h * emuPerPx)),
  });

  // Shape ids are unique within the tree and 1 is the group itself; the title,
  // when there is one, is 2.
  let nextId = 3;
  const drawn = shapes.shapes
    .map((shape) =>
      shape.kind === 'edge'
        ? edgeShape(shape, nextId++, place, emuPerPx)
        : nodeShape(shape, nextId++, place, emuPerPx)
    )
    .join('');

  return (
    DECLARATION +
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    (title ? titleShape(title, slide) : '') +
    drawn +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/**
 * The slide, holding the diagram as a picture.
 *
 * Ordinarily the blip is the PNG with the SVG hung off it as an extension,
 * which is the arrangement PowerPoint understands: draw the vector, fall back
 * to the raster. A view that cannot produce a raster at all -- the genome-wide
 * view draws to a canvas -- embeds the SVG as the blip itself rather than
 * naming a part that is not in the package.
 */
function slideXml({ title, at, slide, hasRaster = true }) {
  return (
    DECLARATION +
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    (title ? titleShape(title, slide) : '') +
    `<p:pic><p:nvPicPr><p:cNvPr id="3" name="${escapeXml(title || 'Diagram')}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill>` +
    (hasRaster
      ? `<a:blip r:embed="rId2"><a:extLst><a:ext uri="${SVG_BLIP_EXT}">` +
        `<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" ` +
        `r:embed="rId3"/></a:ext></a:extLst></a:blip>`
      : `<a:blip r:embed="rId3"/>`) +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${at.x}" y="${at.y}"/><a:ext cx="${at.cx}" cy="${at.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/** An empty shape tree, which both the master and the layout need. */
const EMPTY_TREE =
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const CLR_MAP =
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
  `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" ` +
  `folHlink="folHlink"/>`;

const SLIDE_MASTER =
  DECLARATION +
  `<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
  `<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill>` +
  `<a:effectLst/></p:bgPr></p:bg>${EMPTY_TREE}</p:cSld>${CLR_MAP}` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `</p:sldMaster>`;

const SLIDE_LAYOUT =
  DECLARATION +
  `<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" ` +
  `preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** The presentation, whose slide size is the size this diagram needs. */
function presentationXml(slide) {
  return (
    DECLARATION +
    `<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
    `<p:sldSz cx="${slide.cx}" cy="${slide.cy}"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  );
}

/** Three fills, three lines, three effects and three backgrounds: the minimum. */
const FORMAT_SCHEME =
  `<a:fmtScheme name="Office">` +
  `<a:fillStyleLst>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `</a:fillStyleLst>` +
  `<a:lnStyleLst>` +
  `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/>` +
  `</a:solidFill><a:prstDash val="solid"/></a:ln>` +
  `<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/>` +
  `</a:solidFill><a:prstDash val="solid"/></a:ln>` +
  `<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/>` +
  `</a:solidFill><a:prstDash val="solid"/></a:ln>` +
  `</a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `</a:bgFillStyleLst></a:fmtScheme>`;

const THEME =
  DECLARATION +
  `<a:theme xmlns:a="${NS.a}" name="Reactome"><a:themeElements>` +
  `<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink>` +
  `<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Office">` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/>` +
  `</a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/>` +
  `</a:minorFont></a:fontScheme>` +
  FORMAT_SCHEME +
  `</a:themeElements></a:theme>`;

const CONTENT_TYPES =
  DECLARATION +
  `<Types xmlns="${NS.ct}">` +
  `<Default Extension="rels" ` +
  `ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="png" ContentType="image/png"/>` +
  `<Default Extension="svg" ContentType="image/svg+xml"/>` +
  [
    ['/ppt/presentation.xml', 'presentationml.presentation.main+xml'],
    ['/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster+xml'],
    ['/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout+xml'],
    ['/ppt/slides/slide1.xml', 'presentationml.slide+xml'],
  ]
    .map(
      ([part, type]) =>
        `<Override PartName="${part}" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`
    )
    .join('') +
  `<Override PartName="/ppt/theme/theme1.xml" ` +
  `ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
  `</Types>`;

/**
 * Build the .pptx.
 *
 * Shapes win when the page could describe the diagram as shapes; the picture is
 * what a view that is not made of shapes falls back to. The two paths differ in
 * one part and two relationships, so the package is assembled once.
 *
 * @param {object} figure
 * @param {string} [figure.svg]  the diagram as SVG, what PowerPoint draws
 * @param {Buffer} [figure.png]  the same diagram as PNG, the fallback
 * @param {number} figure.width  natural width in pixels, for the aspect ratio
 * @param {number} figure.height natural height in pixels
 * @param {string} [figure.title] shown above the diagram; omitted if empty
 * @param {import('../../projects/pathway-browser/src/app/render/render-shapes.model')
 *   .RenderShapes | null} [figure.shapes] the diagram as shapes, when it has them
 * @returns {Buffer} the zipped package
 */
export function pptx({ svg = '', png = null, width, height, title = '', shapes = null }) {
  // An empty shape list is not a diagram; treat it as no shapes at all so the
  // slide holds the picture rather than nothing.
  const drawShapes = Boolean(shapes?.shapes?.length);

  // The slide is sized for whatever it is going to hold, so this comes first.
  const figure = drawShapes ? { width: shapes.width, height: shapes.height } : { width, height };
  const { slide, at, emuPerPx } = layout({ ...figure, hasTitle: Boolean(title) });

  const parts = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(
      relationships([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }])
    ),
    'ppt/presentation.xml': strToU8(presentationXml(slide)),
    'ppt/_rels/presentation.xml.rels': strToU8(
      relationships([
        { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
        { id: 'rId2', type: 'slide', target: 'slides/slide1.xml' },
        { id: 'rId3', type: 'theme', target: 'theme/theme1.xml' },
      ])
    ),
    'ppt/slideMasters/slideMaster1.xml': strToU8(SLIDE_MASTER),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(
      relationships([
        { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
      ])
    ),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(SLIDE_LAYOUT),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(
      relationships([
        { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' },
      ])
    ),
    'ppt/slides/slide1.xml': strToU8(
      drawShapes
        ? shapesSlideXml({ title, shapes, at, emuPerPx, slide })
        : slideXml({ title, at, slide, hasRaster: Boolean(png) })
    ),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      relationships([
        { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        // A relationship to a part that is not in the package is exactly what
        // makes PowerPoint offer to repair a file, so the image relationships
        // exist only when the images do.
        ...(drawShapes
          ? []
          : [
              ...(png ? [{ id: 'rId2', type: 'image', target: '../media/image1.png' }] : []),
              { id: 'rId3', type: 'image', target: '../media/image1.svg' },
            ]),
      ])
    ),
    'ppt/theme/theme1.xml': strToU8(THEME),
  };

  if (!drawShapes) {
    if (png) parts['ppt/media/image1.png'] = new Uint8Array(png);
    parts['ppt/media/image1.svg'] = strToU8(svg);
  }

  return Buffer.from(zipSync(parts, { level: 6 }));
}
