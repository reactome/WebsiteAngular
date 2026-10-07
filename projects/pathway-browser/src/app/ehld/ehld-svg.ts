const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Parse an illustration (EHLD) as the XML it is.
 *
 * These used to go in through `innerHTML`, which parses as HTML. Figma exports
 * draw some gradients as an XHTML `<div .../>` inside `<foreignObject>`; in XML
 * that div is closed, but the HTML parser ignores `/>` on a div, leaves it open
 * and nests the rest of the drawing inside it. Circadian clock (R-HSA-9909396)
 * rendered as a blue square with its pills, arrows and labels gone.
 *
 * Throws on a file that is not a well-formed SVG, so the reader is told the
 * illustration could not be drawn instead of shown part of one.
 */
export function parseEhldSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (
    doc.getElementsByTagName('parsererror').length ||
    root.namespaceURI !== SVG_NS ||
    root.localName !== 'svg'
  ) {
    throw new Error('The illustration file could not be read as SVG');
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}
