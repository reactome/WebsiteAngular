/** Where a rectangle sits and how its corners round, in the illustration's units. */
export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

/**
 * The outline an analysis draws inside a region's label box: a copy of the
 * box, unfilled, inset by half the stroke so the stroke stays inside it.
 *
 * Made the same way whatever the box carries when it is copied. The box's own
 * `style` is reset before each colouring, but the box can arrive with an empty
 * one, and a copy taken then kept it: the copy's `style` was then written before
 * its `class`, and otherwise after it. Two drawings of one illustration with one
 * analysis came out different by that alone (spec 018 T012). The copy keeps
 * nothing of the box's style: everything it shows is set here.
 */
export function innerStrokeRect(
  box: SVGRectElement,
  at: RectBox,
  colour: string,
  strokeWidth: number
): SVGRectElement {
  const half = strokeWidth / 2;
  const stroke = box.cloneNode() as SVGRectElement;
  stroke.removeAttribute('style');
  stroke.classList.add('inner-stroke');
  stroke.style.fill = 'none';
  stroke.style.filter = 'none';
  stroke.style.stroke = colour;
  stroke.style.strokeWidth = String(strokeWidth);
  stroke.style.x = String(at.x + half);
  stroke.style.y = String(at.y + half);
  stroke.style.width = String(at.width - strokeWidth);
  stroke.style.height = String(at.height - strokeWidth);
  stroke.style.rx = String(at.rx - half);
  return stroke;
}
