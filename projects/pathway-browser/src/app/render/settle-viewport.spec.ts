import { describe, expect, it } from 'vitest';
import { settleViewport, type Animating } from './settle-viewport';

/**
 * A graph with an animation of `frames` frames running, as cytoscape's: a stop
 * that jumps to the end sets its duration to 0, and the next frame ends it.
 */
function animating(frames: number): Animating & { tick(): void; ended: boolean; queued: number } {
  let left = frames;
  return {
    ended: false,
    queued: 1,
    stop(clearQueue, jumpToEnd) {
      if (clearQueue) this.queued = 0;
      if (jumpToEnd) left = Math.min(left, 1);
    },
    animated: () => left > 0,
    tick() {
      if (left > 0 && --left === 0) this.ended = true;
    },
  };
}

describe('settleViewport', () => {
  it('ends a running fit at its end within a frame, not after its second', async () => {
    // a second's fit at 60 frames a second, as the diagram's select() runs
    const graph = animating(60);
    let frames = 0;
    const settled = await settleViewport([graph], async () => {
      frames += 1;
      graph.tick();
    });
    expect(settled).toBe(true);
    expect(graph.ended).toBe(true);
    expect(frames).toBe(1);
    // nothing queued to start after it
    expect(graph.queued).toBe(0);
  });

  it('settles every graph: the diagram and its comparison', async () => {
    const graphs = [animating(60), animating(30)];
    const settled = await settleViewport(graphs, async () => {
      for (const graph of graphs) graph.tick();
    });
    expect(settled).toBe(true);
    expect(graphs.every((graph) => graph.ended)).toBe(true);
  });

  it('a graph not animating costs no frame', async () => {
    const graph = animating(0);
    let frames = 0;
    expect(
      await settleViewport([graph], async () => {
        frames += 1;
      })
    ).toBe(true);
    expect(frames).toBe(0);
  });

  it('says so when an animation will not end', async () => {
    const stuck: Animating = { stop: () => undefined, animated: () => true };
    expect(await settleViewport([stuck], async () => undefined, 5)).toBe(false);
  });
});
