import { describe, expect, it } from 'vitest';
import { parseEhldSvg } from './ehld-svg';

/**
 * Reduced from the Circadian clock illustration (R-HSA-9909396), a Figma export
 * that draws a conic gradient as an XHTML `<div/>` inside `<foreignObject>`.
 * In XML `/>` closes the div. The HTML parser ignores `/>` on a div, so it
 * stays open and swallows the rest of the drawing into the gradient.
 */
const FIGMA_GRADIENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g id="region">
    <g clip-path="url(#c)"><foreignObject width="10" height="10">
      <div xmlns="http://www.w3.org/1999/xhtml" style="background:conic-gradient(red, blue)"/>
    </foreignObject></g>
    <path id="arrow" d="M0 0L10 10"/>
    <text id="label">CLOCK:BMAL1</text>
  </g>
  <g id="after"><rect width="5" height="5"/></g>
</svg>`;

describe('parseEhldSvg', () => {
  it('keeps what follows a self-closing XHTML element in the drawing', () => {
    const svg = parseEhldSvg(FIGMA_GRADIENT);
    const region = svg.querySelector('#region')!;
    expect(region.querySelector(':scope > #arrow')).not.toBeNull();
    expect(region.querySelector(':scope > #label')?.textContent).toBe('CLOCK:BMAL1');
    expect(svg.querySelector(':scope > #after')).not.toBeNull();
    expect(svg.querySelector('foreignObject div')?.childElementCount).toBe(0);
  });

  it('returns an SVG element in the SVG namespace', () => {
    const svg = parseEhldSvg(FIGMA_GRADIENT);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.localName).toBe('svg');
  });

  it('refuses a file that is not well-formed, rather than drawing part of it', () => {
    expect(() => parseEhldSvg('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toThrow(
      /illustration/i
    );
  });

  it('refuses a file whose root is not an svg', () => {
    expect(() => parseEhldSvg('<html><body>Not found</body></html>')).toThrow(/illustration/i);
  });
});
