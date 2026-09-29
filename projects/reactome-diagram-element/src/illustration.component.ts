import { Component, model, output } from '@angular/core';
import { EhldComponent } from '../../pathway-browser/src/app/ehld/ehld.component';
import { SvgExporterService } from '../../pathway-browser/src/app/reacfoam/svg-exporter.service';

/**
 * An illustrated pathway (EHLD) in the embedded diagram, loaded only when one
 * is shown (`@defer` in the element's template), so its code stays out of the
 * diagram's own bundle.
 *
 * The illustration component asks for the SVG exporter, which is for the
 * site's download menu: the embed has none, and the real exporter would bring
 * Reacfoam with it -- a root service that reads the page's address, which the
 * embed's root guards refuse. So it gets one that says it is not here.
 */
@Component({
  selector: 'reactome-illustration',
  imports: [EhldComponent],
  providers: [
    {
      provide: SvgExporterService,
      useValue: {
        exportEHLD: () => Promise.reject(new Error('The embedded diagram has no SVG export.')),
      } satisfies Pick<SvgExporterService, 'exportEHLD'>,
    },
  ],
  template: `
    <cr-ehld
      [(pathwayId)]="pathwayId"
      (illustrationLoaded)="illustrationLoaded.emit($event)"
      (illustrationFailed)="illustrationFailed.emit($event)"
    />
  `,
  styles: ':host { display: block; width: 100%; height: 100%; }',
})
export class IllustrationComponent {
  readonly pathwayId = model.required<string>();
  readonly illustrationLoaded = output<string>();
  readonly illustrationFailed = output<string>();
}
