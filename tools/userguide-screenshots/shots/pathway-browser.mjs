/**
 * Shots for projects/website-angular/content/documentation/userguide/pathway-browser.mdx.
 *
 * Pathways are the guide's own examples: Signaling by ERBB4 (R-HSA-1236394)
 * for the browser and its sub-pathway shading, Hemostasis (R-HSA-109582) for
 * an enhanced high-level diagram, Platelet homeostasis (R-HSA-418346) for the
 * hierarchy and diagram highlighting each other.
 */

/** The diagram has drawn, and settled. */
async function diagramDrawn(page) {
  await page.waitForFunction(
    () => (document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy?.nodes().length ?? 0) > 0,
    null,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(2500);
}

/**
 * The diagram at a zoom level, about its centre. The renderer changes what it
 * shows with zoom (ngx-reactome-cytoscape-style): sub-pathway shading and its
 * labels up to 20%, gone by 40%; common small molecules fading in from 40% to
 * 60%; protein and molecule structures from 130% to 150%. The first stage is
 * the fitted view, subpathway-shading.png.
 */
function zoomedTo(level) {
  return async (page) => {
    await diagramDrawn(page);
    await page.evaluate((level) => {
      const container = document.querySelector('cr-diagram #cytoscape');
      const cy = container._cyreg.cy;
      cy.zoom({
        level,
        renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 },
      });
    }, level);
    await page.waitForTimeout(2500);
  };
}

/** An enhanced high-level diagram has drawn. */
async function illustrationDrawn(page) {
  await page.locator('cr-ehld svg').first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
}

export const shots = [
  {
    name: 'home-pathway-browser-button',
    url: '/',
    prepare: async (page) => {
      await page
        .locator('a.shortcut-link', { hasText: 'Pathway Browser' })
        .first()
        .waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1000);
    },
    clip: { selector: 'a.shortcut-link:has-text("Pathway Browser")', pad: 12 },
  },
  {
    // The map of all pathways the browser opens on (Reacfoam), where the old
    // browser opened on its Fireworks overview.
    name: 'pathway-overview-map',
    url: '/PathwayBrowser/',
    prepare: async (page) => {
      await page.locator('cr-reacfoam canvas').first().waitFor({ timeout: 120_000 });
      // Roll-out and relaxation run for a few seconds.
      await page.waitForTimeout(8000);
    },
  },
  {
    name: 'pathway-browser-labelled',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: diagramDrawn,
    labels: [
      '.left-panel .search',
      '.species-content',
      '.overlay-content',
      '.event-hierarchy',
      '.analysis-button-group button.primary',
      '.top-left button:has-text("Compare")',
      '.right-panel .title',
      '[aria-label="Tour"]',
      '[aria-label="Layout"]',
      '.top-right mat-slide-toggle',
      '[aria-label="Cite us"]',
      '.top-right .logo',
      'cr-diagram #controls',
      'cr-diagram .thumbnail',
      '#legend-handle',
      '.custom-tab-group .mat-mdc-tab-header',
    ],
  },
  {
    name: 'hierarchy-icon-tooltip',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: async (page) => {
      await diagramDrawn(page);
      await page.locator('.event-hierarchy .tree-node.child-less mat-icon').first().hover();
      await page.locator('.mat-mdc-tooltip').first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
    },
    clip: { x: 0, y: 120, width: 282, height: 560 },
  },
  {
    name: 'reaction-with-catalyst',
    url: '/PathwayBrowser/R-HSA-70326?select=R-HSA-70486',
    prepare: diagramDrawn,
    clip: 'cr-diagram',
  },
  {
    name: 'reaction-with-regulation',
    url: '/PathwayBrowser/R-HSA-70326?select=R-HSA-70467',
    prepare: diagramDrawn,
    clip: 'cr-diagram',
  },
  {
    name: 'zoom-2-small-molecules',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: zoomedTo(0.6),
    clip: 'cr-diagram',
  },
  {
    name: 'zoom-3-structures',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: zoomedTo(1.6),
    clip: 'cr-diagram',
  },
  {
    name: 'enhanced-high-level-diagram',
    url: '/PathwayBrowser/R-HSA-109582',
    prepare: illustrationDrawn,
  },
  {
    name: 'subpathway-shading',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: diagramDrawn,
    clip: 'cr-diagram',
  },
  {
    name: 'subpathway-selection',
    url: '/PathwayBrowser/R-HSA-418346',
    prepare: async (page) => {
      await diagramDrawn(page);
      // The row's icon rather than its name: a long name scrolls under the pointer.
      await page
        .locator('.event-hierarchy .tree-node', { hasText: 'Platelet calcium homeostasis' })
        .first()
        .locator('mat-icon')
        .first()
        .hover();
      await page.waitForTimeout(1500);
    },
  },
  {
    name: 'legend-reaction-nodes',
    url: '/PathwayBrowser/R-HSA-1236394',
    prepare: async (page) => {
      await diagramDrawn(page);
      await page.locator('#legend-handle').click();
      await page.waitForTimeout(2000);
    },
    clip: { selector: 'cr-diagram #legend', pad: 0 },
    scale: 2,
  },
];
