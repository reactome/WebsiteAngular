import { Component } from '@angular/core';
import { RouterOutlet, RouterLinkWithHref, RouterLinkActive } from '@angular/router';
import { NavigationBarComponent } from "./navigation-bar/navigation-bar.component";
import { InfoFooterComponent } from "./info-footer/info-footer.component";
import { copyrightFooterComponent } from "./copyright-footer/copyright-footer.component";
import { CiteUsComponent } from "./cite-us/cite-us.component";
import { ScrollToTopComponent } from "./scroll-to-top/scroll-to-top.component";

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLinkWithHref, RouterLinkActive, NavigationBarComponent, InfoFooterComponent, copyrightFooterComponent, CiteUsComponent, ScrollToTopComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'WebsiteAngular';
}
