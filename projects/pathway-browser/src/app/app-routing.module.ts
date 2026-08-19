import { Routes } from '@angular/router';
import { ViewportComponent } from './viewport/viewport.component';
import { RenderComponent } from './render/render.component';
import { ENVIRONMENT_INITIALIZER, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { IconService } from './services/icon.service';
import { provideUiTour } from 'ngx-ui-tour-md-menu';

const registerPathwayBrowserIcons = () => {
  const matIconRegistry = inject(MatIconRegistry);
  const domSanitizer = inject(DomSanitizer);
  const iconService = inject(IconService);

  return () => {
    const speciesIcon = iconService.getSpeciesIcons();
    const generalIcons = iconService.getGeneralIcons();
    const reactomeSubjectIcons = iconService.getReactomeSubjectIcons();
    const connectors = iconService.getConnectors();

    matIconRegistry.registerFontClassAlias('symbols', 'material-symbols-rounded');

    speciesIcon.forEach((icon) => {
      matIconRegistry.addSvgIcon(
        icon.name,
        domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/species/${icon.route}.svg`)
      );
    });

    generalIcons.forEach((icon) => {
      matIconRegistry.addSvgIcon(
        icon.name,
        domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/general/${icon.route}.svg`)
      );
    });

    connectors.forEach((connector) => {
      matIconRegistry.addSvgIcon(
        connector.name,
        domSanitizer.bypassSecurityTrustResourceUrl(`assets/connector/${connector.route}.svg`)
      );
    });

    Object.values(reactomeSubjectIcons).forEach((icon) => {
      matIconRegistry.addSvgIcon(
        icon.name,
        domSanitizer.bypassSecurityTrustResourceUrl(
          `assets/icons/reactome-subject/${icon.route}.svg`
        )
      );
    });
  };
};

export const routes: Routes = [
  // Headless rendering: /render and /render/:pathwayId draw a pathway with no
  // panels or navigation and announce when they are finished, so a build step
  // or a service can take the result. Declared before the catch-all matcher
  // below, which would otherwise read "render" as a stable identifier.
  {
    path: 'render',
    providers: [
      {
        provide: ENVIRONMENT_INITIALIZER,
        multi: true,
        useFactory: registerPathwayBrowserIcons,
      },
    ],
    children: [
      { path: '', component: RenderComponent },
      { path: ':pathwayId', component: RenderComponent },
    ],
  },
  {
    matcher: (segments) =>
      segments.length === 0
        ? { consumed: segments }
        : { consumed: segments, posParams: { pathwayId: segments[0] } },
    providers: [
      // ngx-ui-tour 16 stopped providing TourService in root, so it has to be
      // provided explicitly or the GSA form's tour anchors fail with NG0201 and
      // take the whole viewport down. It belongs here rather than in the root
      // ApplicationConfig: the tour is only reachable through the lazily loaded
      // Pathway Browser, and providing it at the root pulled ngx-ui-tour +
      // ngx-ui-tour-core (~275 kB) into the initial bundle.
      provideUiTour(),
      {
        provide: ENVIRONMENT_INITIALIZER,
        multi: true,
        useFactory: registerPathwayBrowserIcons,
      },
    ],
    component: ViewportComponent,
  },
];
