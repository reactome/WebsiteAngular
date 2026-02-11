import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavigationBarComponent } from "./navigation-bar/navigation-bar.component";
import { InfoFooterComponent } from "./info-footer/info-footer.component";
import { copyrightFooterComponent } from "./copyright-footer/copyright-footer.component";
import { CiteUsComponent } from "./cite-us/cite-us.component";
import { ScrollToTopComponent } from "./scroll-to-top/scroll-to-top.component";
import { MatIconRegistry } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavigationBarComponent, InfoFooterComponent, copyrightFooterComponent, CiteUsComponent, ScrollToTopComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'WebsiteAngular';

  constructor(private matIconRegistry: MatIconRegistry) {}

  ngOnInit(): void {
    this.matIconRegistry.registerFontClassAlias('symbols', 'material-symbols-rounded');
  }
}
