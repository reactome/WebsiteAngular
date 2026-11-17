import { describe, expect, it } from 'vitest';
import { innerStrokeRect } from './inner-stroke';

const SVG = 'http://www.w3.org/2000/svg';
const AT = { x: 1146, y: 385, width: 183, height: 30, rx: 8 };

/** A region's label box as an illustration ships it, with `style` as given. */
function box(style: string | null): SVGRectElement {
  const rect = document.createElementNS(SVG, 'rect');
  for (const [name, value] of Object.entries({ ...AT, fill: '#BA1149' }))
    rect.setAttribute(name, String(value));
  if (style !== null) rect.setAttribute('style', style);
  return rect;
}

const markup = (style: string | null) =>
  new XMLSerializer().serializeToString(innerStrokeRect(box(style), AT, '#BAEAFF', 2));

describe('innerStrokeRect', () => {
  // Spec 018 T012: one illustration drawn twice with one analysis differed in
  // where this outline's `style` was written, by whether the box it copies had
  // an empty `style` at the time.
  it('is the same outline whether the box has an empty style or none', () => {
    expect(markup('')).toBe(markup(null));
  });

  it('takes nothing of what the box was coloured with', () => {
    expect(markup('fill: url("#pattern-x"); opacity: 0.5')).toBe(markup(null));
  });

  it('is the box, unfilled, with its class before its style', () => {
    const outline = innerStrokeRect(box(null), AT, '#BAEAFF', 2);
    expect(outline.getAttributeNames()).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rx',
      'fill',
      'class',
      'style',
    ]);
    expect(outline.getAttribute('class')).toBe('inner-stroke');
    expect(outline.style.fill).toBe('none');
    expect(outline.style.stroke).toBe('rgb(186, 234, 255)');
  });
});
