/**
 * PowerPoint of a rendered diagram.
 *
 * The slide holds one picture, and that picture is the SVG the site exported,
 * with a PNG beside it as the fallback. PowerPoint 2016 and later draw the SVG
 * and offer "Convert to Shape", which turns it into ordinary editable shapes;
 * anything older, and anything that is not PowerPoint, gets the PNG.
 *
 * That is a deliberate choice against reimplementing the diagram in DrawingML.
 * The Java exporter does reimplement it -- a shape class per glyph type, driven
 * by Aspose.Slides -- and gets shapes that are editable the moment the file
 * opens. It also gets a second renderer to keep in step with the first, which is
 * exactly the drift this work exists to remove, and a commercial dependency. One
 * click for editability is worth that trade; if curators disagree, the argument
 * to have is about that click.
 *
 * A .pptx is a zip of XML parts. The parts here are the smallest set PowerPoint
 * will open: a presentation, one master, one layout, one slide, and a theme.
 * Nothing is optional -- a missing theme or an unresolved relationship is what
 * makes PowerPoint offer to repair a file.
 */
import { zipSync, strToU8 } from 'fflate';

/** English Metric Units per pixel at 96dpi, the unit all OOXML geometry uses. */
const EMU_PER_PX = 9525;
/** A 16:9 slide, 13.333in by 7.5in: what PowerPoint itself defaults to. */
const SLIDE = { cx: 12192000, cy: 6858000 };
const MARGIN = 274638; // 0.3in
const TITLE_HEIGHT = 461665; // 0.5in

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
 * Where the picture goes: as large as the slide allows without distorting it.
 *
 * Fitting rather than filling matters for a diagram -- a stretched pathway is a
 * wrong pathway, and every glyph in it is a shape whose proportions carry
 * meaning.
 */
function placePicture({ width, height, hasTitle }) {
  const top = MARGIN + (hasTitle ? TITLE_HEIGHT : 0);
  const available = { cx: SLIDE.cx - 2 * MARGIN, cy: SLIDE.cy - top - MARGIN };
  const natural = { cx: width * EMU_PER_PX, cy: height * EMU_PER_PX };
  const scale = Math.min(available.cx / natural.cx, available.cy / natural.cy);
  const cx = Math.round(natural.cx * scale);
  const cy = Math.round(natural.cy * scale);
  return {
    x: Math.round((SLIDE.cx - cx) / 2),
    y: Math.round(top + (available.cy - cy) / 2),
    cx,
    cy,
  };
}

function titleShape(title) {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${MARGIN}" y="${MARGIN}"/>` +
    `<a:ext cx="${SLIDE.cx - 2 * MARGIN}" cy="${TITLE_HEIGHT}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>` +
    `<a:r><a:rPr lang="en-US" sz="1800" b="1" dirty="0"/><a:t>${escapeXml(title)}</a:t></a:r>` +
    `</a:p></p:txBody></p:sp>`
  );
}

function slideXml({ title, width, height }) {
  const at = placePicture({ width, height, hasTitle: Boolean(title) });
  return (
    DECLARATION +
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    (title ? titleShape(title) : '') +
    `<p:pic><p:nvPicPr><p:cNvPr id="3" name="${escapeXml(title || 'Diagram')}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId2"><a:extLst><a:ext uri="${SVG_BLIP_EXT}">` +
    `<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" ` +
    `r:embed="rId3"/></a:ext></a:extLst></a:blip>` +
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

const PRESENTATION =
  DECLARATION +
  `<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
  `<p:sldSz cx="${SLIDE.cx}" cy="${SLIDE.cy}"/>` +
  `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

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
 * @param {object} figure
 * @param {string} figure.svg    the diagram as SVG, what PowerPoint draws
 * @param {Buffer} figure.png    the same diagram as PNG, the fallback
 * @param {number} figure.width  natural width in pixels, for the aspect ratio
 * @param {number} figure.height natural height in pixels
 * @param {string} [figure.title] shown above the diagram; omitted if empty
 * @returns {Buffer} the zipped package
 */
export function pptx({ svg, png, width, height, title = '' }) {
  const parts = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(
      relationships([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }])
    ),
    'ppt/presentation.xml': strToU8(PRESENTATION),
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
    'ppt/slides/slide1.xml': strToU8(slideXml({ title, width, height })),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      relationships([
        { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: 'image', target: '../media/image1.png' },
        { id: 'rId3', type: 'image', target: '../media/image1.svg' },
      ])
    ),
    'ppt/theme/theme1.xml': strToU8(THEME),
    'ppt/media/image1.png': new Uint8Array(png),
    'ppt/media/image1.svg': strToU8(svg),
  };

  return Buffer.from(zipSync(parts, { level: 6 }));
}
