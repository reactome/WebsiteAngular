import { Component, effect, inject, input, signal } from '@angular/core';
import { EntityService } from '../../../services/entity.service';
import { SelectableObject } from '../../../services/event.service';

/** The EBI widget attaches itself to the page as a global. */
declare const expressionAtlasHeatmapHighcharts: {
  render(options: {
    target: string;
    experiment: string;
    query: { gene: { value: string }[] };
  }): void;
};

/**
 * Expression Atlas bundles, loaded on demand.
 *
 * The standalone pathway-browser build puts these in its index.html, which is
 * why this tab works there and rendered an empty box in the deployed app -- that
 * one has its own index.html and never loaded them. Copying the tags across
 * would have put two render-blocking EBI bundles on every page of the site,
 * including the ones that will never show a heatmap, so they are fetched when
 * the tab is first opened instead.
 */
const GXA_BUNDLES = [
  'https://www.ebi.ac.uk/gxa/resources/js-bundles/vendorCommons.bundle.js',
  'https://www.ebi.ac.uk/gxa/resources/js-bundles/expressionAtlasHeatmapHighcharts.bundle.js',
];
const GXA_STYLES = 'https://www.ebi.ac.uk/gxa/resources/css/customized-bootstrap-3.3.5.css';

let widgetLoad: Promise<void> | undefined;

/** Load the bundles once per page, in order -- the heatmap needs its vendor bundle first. */
function loadWidget(): Promise<void> {
  if (widgetLoad) return widgetLoad;

  widgetLoad = (async () => {
    if (!document.querySelector(`link[href="${GXA_STYLES}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = GXA_STYLES;
      document.head.appendChild(link);
    }

    for (const src of GXA_BUNDLES) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`could not load ${src}`));
        document.body.appendChild(script);
      });
    }
  })();

  // A failed load must not be cached as done, or the tab stays broken until reload.
  widgetLoad.catch(() => (widgetLoad = undefined));
  return widgetLoad;
}

@Component({
  selector: 'cr-expression-tab',
  standalone: true,
  templateUrl: './expression-tab.component.html',
  styleUrl: './expression-tab.component.scss',
  imports: [],
})
export class ExpressionTabComponent {
  private entity = inject(EntityService);

  readonly obj = input.required<SelectableObject>();
  readonly failed = signal(false);
  readonly empty = signal(false);

  constructor() {
    effect(() => {
      const selected = this.obj().stId;
      this.entity.loadRefEntities(selected);
      const data = this.entity.refEntities();
      if (!Array.isArray(data)) return;

      const genes = data
        .map((entity: { identifier?: string }) => entity.identifier)
        .filter((id): id is string => !!id)
        .map((value) => ({ value }));

      // Nothing to plot is a normal outcome -- a complex of small molecules has
      // no genes -- and needs saying rather than leaving an empty panel.
      this.empty.set(genes.length === 0);
      if (!genes.length) return;

      loadWidget()
        .then(() => {
          this.failed.set(false);
          expressionAtlasHeatmapHighcharts.render({
            target: 'expressionContainer',
            experiment: 'reference',
            query: { gene: genes },
          });
        })
        .catch((error) => {
          this.failed.set(true);
          console.error('Could not load the Expression Atlas widget', error);
        });
    });
  }
}
