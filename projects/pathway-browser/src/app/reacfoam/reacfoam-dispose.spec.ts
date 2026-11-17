import { describe, expect, it } from 'vitest';
import { ReacfoamComponent } from './reacfoam.component';

// A FoamTree keeps its whole layout, labels and canvases until it is disposed,
// and nothing else lets go of it: on a held render page (spec 018) every
// overview drawn stayed in memory, about 17 MB of heap each, until the page
// was closed. The component disposes the one it made when it is destroyed.

/** The component as ngOnDestroy sees it, with the FoamTree given, or none made. */
function destroyed(made: { dispose(): void } | undefined) {
  ReacfoamComponent.prototype.ngOnDestroy.call({
    sizeObserver: { disconnect() {} },
    download: { figureGone() {} },
    made,
  });
}

describe('the species overview, destroyed', () => {
  it('disposes the FoamTree it made', () => {
    let disposed = 0;
    destroyed({ dispose: () => void disposed++ });
    expect(disposed).toBe(1);
  });

  it('makes none to dispose when it never drew', () => {
    expect(() => destroyed(undefined)).not.toThrow();
  });
});
