import {Routes} from "@angular/router";
import {ViewportComponent} from "./viewport/viewport.component";
import {ENVIRONMENT_INITIALIZER, inject} from "@angular/core";
import {DomSanitizer} from "@angular/platform-browser";
import {MatIconRegistry} from "@angular/material/icon";
import {IconService} from "./services/icon.service";

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

    speciesIcon.forEach(icon => {
      matIconRegistry.addSvgIcon(icon.name, domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/species/${icon.route}.svg`));
    });

    generalIcons.forEach(icon => {
      matIconRegistry.addSvgIcon(icon.name, domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/general/${icon.route}.svg`));
    });

    connectors.forEach(connector => {
      matIconRegistry.addSvgIcon(connector.name, domSanitizer.bypassSecurityTrustResourceUrl(`assets/connector/${connector.route}.svg`));
    });

    Object.values(reactomeSubjectIcons).forEach((icon) => {
      matIconRegistry.addSvgIcon(icon.name, domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/reactome-subject/${icon.route}.svg`));
    });
  };
};

export const routes: Routes = [
  {
    matcher: (segments) => segments.length === 0
      ? {consumed: segments}
      : {consumed: segments, posParams: {pathwayId: segments[0]}},
    providers: [
      {
        provide: ENVIRONMENT_INITIALIZER,
        multi: true,
        useFactory: registerPathwayBrowserIcons
      }
    ],
    component: ViewportComponent,
  },
]
