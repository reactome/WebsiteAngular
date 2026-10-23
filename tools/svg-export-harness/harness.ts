// Harness that renders Reactome's legend pathway with ngx-reactome-cytoscape-style
// against this repo's modified cytoscape (so cy.svg() is exercised).

import cytoscape, { type Core, type ElementsDefinition } from 'cytoscape';
import { Style } from 'ngx-reactome-cytoscape-style';

// Left on the page for a person poking at it in the console, and for
// harness.check.ts, which reads `lastSvg`.
declare global {
  interface Window {
    cytoscape: typeof cytoscape;
    cy: Core;
    reactomeStyle: Style;
    lastSvg?: string;
  }
}

window.cytoscape = cytoscape;

/** An element the page is built with; missing means index.html changed under it. */
function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element as T;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadLegend(): Promise<ElementsDefinition> {
  const res = await fetch('legend.json');
  return (await res.json()) as ElementsDefinition;
}

async function run() {
  const elements = await loadLegend();

  // Prepare two cytoscape instances side-by-side: a live one whose canvas is
  // visible (and which we screenshot for the PNG export), and we use the same
  // instance to export SVG. Reactome's Style needs the live container.
  const liveHost = byId<HTMLDivElement>('cy-live');

  const reactomeStyle = new Style(liveHost);
  const stylesheet = reactomeStyle.getStyleSheet();

  const cy = cytoscape({
    container: liveHost,
    elements,
    style: stylesheet,
    layout: { name: 'preset' },
    pixelRatio: 1,
  });

  reactomeStyle.bindToCytoscape(cy);
  reactomeStyle.clearCache();

  window.cy = cy;
  window.reactomeStyle = reactomeStyle;

  // Reactome's image-builder is async (it generates dataURI backgrounds via a
  // virtual canvas). Wait for the images to settle before exporting so the
  // PNG and SVG see the same final visual state.
  await new Promise((r) => setTimeout(r, 1500));
  cy.fit(undefined, 30);
  await new Promise((r) => setTimeout(r, 500));

  const errors: string[] = [];
  try {
    const png = cy.png({ output: 'base64uri', full: true, scale: 1, bg: '#ffffff' });
    byId<HTMLImageElement>('out-png').src = png;
  } catch (e) {
    errors.push('png: ' + messageOf(e));
  }

  try {
    const svg = cy.svg({ full: true, scale: 1, bg: '#ffffff' });
    byId('out-svg').innerHTML = svg;
    window.lastSvg = svg;
  } catch (e) {
    errors.push('svg: ' + messageOf(e));
  }

  byId('status').textContent =
    errors.length === 0
      ? `OK — rendered ${elements.nodes.length} nodes, ${elements.edges.length} edges`
      : 'ERRORS: ' + errors.join('; ');
}

run().catch((e: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `fatal: ${messageOf(e)}\n${e instanceof Error ? e.stack : ''}`;
});
