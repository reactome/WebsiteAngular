import { type Face, loadFamily } from '../render/label-font';

/**
 * The faces the diagram's labels are drawn in: Roboto at 400 and 600 (which
 * the page's 500 serves), Roboto Mono at 400 and 600 (its 700), as the
 * diagram's style asks for them.
 */
const DIAGRAM_FACES = [
  ['Roboto', '400'],
  ['Roboto', '500'],
  ['Roboto Mono', '400'],
  ['Roboto Mono', '700'],
] as const;

/** How long a diagram waits for them before it draws without them. */
const FONT_WAIT_MS = 2000;

/**
 * The diagram's faces loaded, or the wait over, whichever is first (spec 009
 * T045).
 *
 * Cytoscape measures a label once, when it is first drawn, and keeps that size
 * until the element's style changes: the fonts arriving later redraw the text
 * but not the boxes and bounds measured for it. So a diagram drawn before its
 * fonts was fitted, and stayed fitted, to labels in a fallback font -- on a
 * first visit, or from a slow font host, it was framed differently from the
 * same diagram drawn later (40,000 pixels of a 900 x 520 diagram). A refit
 * after the fonts arrive would measure the same stale sizes; drawing after
 * them measures the right ones.
 *
 * Faces the page has not declared are not waited for, and a face that fails to
 * load is left as it is (loadFamily). A font host slower than the wait draws
 * as before.
 */
export function diagramFontsReady(
  faces: Iterable<Face> = document.fonts,
  wait = FONT_WAIT_MS
): Promise<void> {
  const declared = [...faces];
  const loaded = Promise.all(
    DIAGRAM_FACES.map(([family, weight]) => loadFamily(declared, family, weight))
  ).then(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, wait)));
  return Promise.race([loaded, waited]).finally(() => clearTimeout(timer));
}
