import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import cytoscape from 'cytoscape';
import { interactivityOf, Style } from 'ngx-reactome-cytoscape-style';

import { DiagramComponent } from './diagram.component';
import { DiagramService } from '../services/diagram.service';
import { GeneralService } from '../services/general.service';
import checkpoints from '../../../../../e2e/release-files/98/diagram/R-HSA-69620.json';
import checkpointsGraph from '../../../../../e2e/release-files/98/diagram/R-HSA-69620.graph.json';

/**
 * Clearing a flag gives the sub-pathway bands back as the zoom handler draws
 * them. They were handed back inside the same `cy.batch` that unflagged the
 * diagram, and inside a batch the bands' restored `shadow` class is not yet in
 * their computed style: the handler read their underlay colour as black, took
 * that for "no bands" and hid every one until the next zoom. The same bug was
 * fixed in reactome/ngx-reactome-base#32.
 *
 * Read from the styles cytoscape computes with the library's own style sheet
 * and handlers bound, on Cell Cycle Checkpoints (R-HSA-69620), which has bands,
 * drawn by the diagram service from the recorded release files. The component
 * is used through its prototype: under this vitest setup a component with an
 * external template cannot be made, and flagging needs nothing else of it.
 * jsdom cannot draw, so a canvas that measures and draws nothing stands in.
 */
describe('clearing a flag on the diagram', () => {
  const BASE = 'https://example.org/download';
  let canvas: MockInstance;
  let cy: cytoscape.Core | undefined;

  const diagram = {
    setSubPathwayVisibility: DiagramComponent.prototype.setSubPathwayVisibility,
  };
  const flagElements = (toFlag: cytoscape.CollectionArgument, cy: cytoscape.Core) =>
    DiagramComponent.prototype.flagElements.call(diagram as never, toFlag, cy);

  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false }));
    canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        new Proxy(
          {},
          {
            get: (_target, name) =>
              name === 'measureText'
                ? (text: string) => ({ width: text.length * 6 })
                : () => ({ addColorStop: () => undefined, data: [] }),
            set: () => true,
          }
        ) as never
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GeneralService, useValue: { download$: of(BASE) } },
      ],
    });
  });
  afterEach(() => {
    cy?.destroy();
    cy = undefined;
    canvas.mockRestore();
    vi.unstubAllGlobals();
  });

  async function drawn(): Promise<cytoscape.Core> {
    const id = 'R-HSA-69620';
    const loaded = firstValueFrom(TestBed.inject(DiagramService).getDiagram(id));
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${BASE}/diagram/${id}.json`).flush(structuredClone(checkpoints));
    http.expectOne(`${BASE}/diagram/${id}.graph.json`).flush(structuredClone(checkpointsGraph));
    const elements = await loaded;
    const container = document.createElement('div');
    const style = new Style(container);
    cy = cytoscape({
      container,
      elements,
      style: style.getStyleSheet(),
      layout: { name: 'preset' },
    });
    style.bindToCytoscape(cy);
    return cy;
  }

  const underlay = (e: cytoscape.SingularElementArgument) =>
    Number(e.numericStyle('underlay-opacity' as never));

  it('gives the sub-pathway bands back as the zoom handler draws them', async () => {
    const cy = await drawn();
    const band = cy.edges('[?color]').first();
    expect(band.nonempty()).toBe(true);
    // Zoomed out, where the bands show.
    cy.zoom(0.2);
    interactivityOf(cy)?.onZoom.shadow();
    const before = underlay(band);
    expect(before).toBeGreaterThan(0);

    flagElements(cy.nodes('.reaction').first(), cy);
    expect(underlay(band)).toBe(0);

    flagElements(cy.collection(), cy);
    expect(underlay(band)).toBe(before);
  });

  it('leaves no halo on the lines it flagged', async () => {
    const cy = await drawn();
    const line = cy.edges().not('[?color]').first();
    expect(underlay(line)).toBe(0);
    flagElements(line, cy);
    expect(underlay(line)).toBe(1);
    flagElements(cy.collection(), cy);
    expect(underlay(line)).toBe(0);
  });
});
