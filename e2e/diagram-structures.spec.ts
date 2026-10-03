import { type Page } from '@playwright/test';
import type cytoscape from 'cytoscape';
import { test, expect } from './support/backend';

// The structures drawn inside entity boxes -- chemical structures and protein
// videos -- and what the style library does around them as the reader zooms,
// selects and restyles. These are drawn on HTML layers over the canvas, which
// a unit test cannot create: the layers plugin needs a real renderer.
//
// R-HSA-9679191 has chemicals, drugs and proteins in one diagram. ChEBI is
// stubbed, so no test here depends on a live structure service.

const PATHWAY = '/PathwayBrowser/R-HSA-9679191';
const BOOT = 90_000;

const STRUCTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
<rect width="40" height="40" fill="white"/><circle cx="20" cy="20" r="10"/></svg>`;

type Interactivity = { updateProteins(): void; triggerZoom(): void };
/** A parsed style property, as cytoscape keeps it: `bypass` when set inline. */
type Styled = { pstyle(name: string): { value: unknown; bypass?: boolean } };
type Probe = {
  ng: {
    getComponent(element: Element | null): {
      cy: cytoscape.Core;
      legend: cytoscape.Core;
    };
  };
};

async function open(page: Page, chebi: 'found' | 'missing') {
  await page.route('**/www.ebi.ac.uk/chebi/**', (route) =>
    chebi === 'found'
      ? route.fulfill({ contentType: 'image/svg+xml', body: STRUCTURE })
      : route.fulfill({ status: 404, body: '' })
  );
  await page.goto(PATHWAY, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.querySelector('cr-diagram');
          const probe = (window as unknown as Partial<Probe>).ng;
          if (!host || !probe) return 0;
          return probe.getComponent(host)?.cy?.nodes('.Molecule').length ?? 0;
        }),
      { timeout: BOOT }
    )
    .toBeGreaterThan(0);
  // The structures arrive after the diagram: none still loading.
  await expect
    .poll(() => page.locator('cr-diagram #cytoscape .molecule-structure.loading').count(), {
      timeout: 30_000,
    })
    .toBe(0);
}

test.describe('Structures inside entity boxes', () => {
  test.setTimeout(4 * 60 * 1000);

  test('hides chemical structures until the reader zooms in to them', async ({ page }) => {
    await open(page, 'found');
    // A graph styled and never zoomed, as a page using the library may leave
    // it. The site's own diagram is fitted after it is styled, and that zoom
    // hid the fault.
    const { zoom, molecule, video } = await page.evaluate(() => {
      const cy = (window as unknown as Probe).ng.getComponent(
        document.querySelector('cr-diagram')
      ).cy;
      type Ctor<T> = new (...args: unknown[]) => T;
      const Core = cy.constructor as Ctor<cytoscape.Core>;
      const Style = (cy.data('reactome') as object).constructor as Ctor<{
        bindToCytoscape(cy: cytoscape.Core): void;
      }>;
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:300px';
      document.body.append(container);
      const fresh = new Core({ container, elements: cy.nodes('.Molecule, .Protein').jsons() });
      new Style(container).bindToCytoscape(fresh);
      const layer = (name: string) =>
        (container.querySelector(`.${name}`) as HTMLElement | null)?.style.opacity;
      return { zoom: fresh.zoom(), molecule: layer('molecule'), video: layer('video') };
    });
    expect(zoom, 'not zoomed in to the structures').toBeLessThan(1.3);
    // As the protein videos are. The zoom handler ran before this layer
    // existed, so it was drawn at full opacity until the first zoom.
    expect(molecule).toBe('0');
    expect(video).toBe('0');
  });

  test('hides the structure of a molecule that is hidden', async ({ page }) => {
    await open(page, 'found');
    const shown = await page.evaluate(async () => {
      const cy = (window as unknown as Probe).ng.getComponent(
        document.querySelector('cr-diagram')
      ).cy;
      cy.nodes('.Molecule').style('visibility', 'hidden');
      cy.panBy({ x: 1, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const structures = cy.container()?.querySelectorAll<HTMLElement>('.molecule-structure');
      return [...(structures ?? [])].filter((e) => e.style.visibility !== 'hidden').length;
    });
    expect(shown).toBe(0);
  });

  test('centres the label of a molecule whose structure cannot be found', async ({ page }) => {
    await open(page, 'missing');
    const inline = (page: Page) =>
      page.evaluate(() => {
        const cy = (window as unknown as Probe).ng.getComponent(
          document.querySelector('cr-diagram')
        ).cy;
        // A label moved aside to make room for a structure that is not there.
        return cy
          .nodes('.Molecule')
          .filter((n) => (n as unknown as Styled).pstyle('text-margin-x').bypass === true)
          .map((n) => n.data('displayName') as string);
      });
    expect(await inline(page), 'once the structure fails').toEqual([]);

    // Opening interactors recounts the boxes that hold structures; the ones
    // that failed must stay out.
    await page.evaluate(() => {
      const cy = (window as unknown as Probe).ng.getComponent(
        document.querySelector('cr-diagram')
      ).cy;
      const interactivity = cy.scratch('_reactomeInteractivity') as Interactivity;
      interactivity.updateProteins();
      interactivity.triggerZoom();
    });
    expect(await inline(page), 'after the boxes are recounted').toEqual([]);
  });

  test('puts a drug back as it was when it is unselected', async ({ page }) => {
    await open(page, 'found');
    const lengths = await page.evaluate(() => {
      const cy = (window as unknown as Probe).ng.getComponent(
        document.querySelector('cr-diagram')
      ).cy;
      const drug = cy.nodes('.Molecule.drug').first();
      const styled = drug as unknown as Styled;
      drug.select();
      drug.unselect();
      return {
        found: drug.length,
        images: (styled.pstyle('background-image').value as string[]).length,
        positions: (styled.pstyle('background-position-x').value as unknown[]).length,
      };
    });
    expect(lengths.found, 'the diagram has a drug').toBe(1);
    // One position per image: the decoration is placed for what is drawn now,
    // not for the selected drawing with its extra layer.
    expect(lengths.positions).toBe(lengths.images);
  });

  test('restyles the graph it is asked to, not the last one bound', async ({ page }) => {
    await open(page, 'found');
    const calls = await page.evaluate(() => {
      const c = (window as unknown as Probe).ng.getComponent(document.querySelector('cr-diagram'));
      const count = { diagram: 0, legend: 0 };
      for (const [name, cy] of [
        ['diagram', c.cy],
        ['legend', c.legend],
      ] as const) {
        const interactivity = cy.scratch('_reactomeInteractivity') as Interactivity;
        const original = interactivity.triggerZoom.bind(interactivity);
        interactivity.triggerZoom = () => {
          count[name]++;
          original();
        };
      }
      (c.cy.data('reactome') as { update(cy: cytoscape.Core): void }).update(c.legend);
      return count;
    });
    expect(calls).toEqual({ diagram: 0, legend: 1 });
  });
});
