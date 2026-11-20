/** What of a cytoscape graph settling its viewport needs. */
export interface Animating {
  stop(clearQueue?: boolean, jumpToEnd?: boolean): unknown;
  animated(): boolean;
}

/** One animation frame. */
const nextFrame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Ends every viewport animation still running on the graphs, at its end, and
 * waits until none is. Resolves whether they settled within `maxFrames`.
 *
 * The diagram fits its view with an animation of a second (`select()`), and
 * the sub-pathways' bands take their opacity from the zoom. A figure exported
 * while the fit runs has the bands at the zoom of that moment: on a held page,
 * which draws quicker than a fresh one, R-HSA-975957's bands came out at
 * opacity 0.007 to 0.017 where a fresh page's are 0.018 (spec 018 T009).
 * Jumped to its end, the fit leaves the view, and so the bands, as a fresh
 * page has them once it has finished.
 */
export async function settleViewport(
  graphs: readonly Animating[],
  frame: () => Promise<unknown> = nextFrame,
  maxFrames = 60
): Promise<boolean> {
  // jumpToEnd sets each animation's duration to 0; the next frame of
  // cytoscape's loop applies its end, which fires the zoom its handlers read.
  for (const graph of graphs) graph.stop(true, true);
  for (let frames = 0; graphs.some((graph) => graph.animated()); frames++) {
    if (frames >= maxFrames) return false;
    await frame();
  }
  return true;
}
