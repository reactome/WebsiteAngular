import { Component, OnInit, inject } from '@angular/core';
import {DomSanitizer} from "@angular/platform-browser";
import {MatIconRegistry} from "@angular/material/icon";
import {IconService} from "./services/icon.service";
import {RouterOutlet} from "@angular/router";

@Component({
  selector: 'cr-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private matIconRegistry = inject(MatIconRegistry);
  private domSanitizer = inject(DomSanitizer);
  private iconService = inject(IconService);

  title = 'PathwayBrowser'


  ngOnInit(): void {

    const speciesIcon = this.iconService.getSpeciesIcons();
    const generalIcons = this.iconService.getGeneralIcons();
    const reactomeSubjectIcons = this.iconService.getReactomeSubjectIcons();
    const connectors = this.iconService.getConnectors();
    this.matIconRegistry.registerFontClassAlias('symbols', 'material-symbols-rounded')

    speciesIcon.forEach(icon => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/species/${icon.route}.svg`));
    });

    generalIcons.forEach(icon => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/general/${icon.route}.svg`));
    });

    connectors.forEach(connector => {
      this.matIconRegistry.addSvgIcon(connector.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/connector/${connector.route}.svg`));
    })

    Object.values(reactomeSubjectIcons).forEach((icon) => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/reactome-subject/${icon.route}.svg`));
    });
  }
}
