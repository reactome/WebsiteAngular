// Harness that renders Reactome's legend pathway with reactome-cytoscape-style
// against this repo's modified cytoscape (so cy.svg() is exercised).

import cytoscape from 'cytoscape';
import { Style } from 'reactome-cytoscape-style';

window.cytoscape = cytoscape;

async function loadLegend() {
  const res = await fetch('legend.json');
  return await res.json();
}

async function run() {
  const elements = await loadLegend();

  // Prepare two cytoscape instances side-by-side: a live one whose canvas is
  // visible (and which we screenshot for the PNG export), and we use the same
  // instance to export SVG. Reactome's Style needs the live container.
  const liveHost = document.getElementById('cy-live');

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

  const errors = [];
  try {
    const png = cy.png({ output: 'base64uri', full: true, scale: 1, bg: '#ffffff' });
    document.getElementById('out-png').src = png;
  } catch (e) {
    errors.push('png: ' + e.message);
  }

  try {
    const svg = cy.svg({ full: true, scale: 1, bg: '#ffffff' });
    document.getElementById('out-svg').innerHTML = svg;
    window.lastSvg = svg;
  } catch (e) {
    errors.push('svg: ' + e.message);
  }

  document.getElementById('status').textContent =
    errors.length === 0
      ? `OK — rendered ${elements.nodes.length} nodes, ${(elements.edges || []).length} edges`
      : 'ERRORS: ' + errors.join('; ');
}

run().catch((e) => {
  document.getElementById('status').textContent = 'fatal: ' + e.message + '\n' + e.stack;
});
