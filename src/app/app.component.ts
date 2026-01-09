import { Component } from '@angular/core';
import { RouterOutlet, RouterLinkWithHref, RouterLinkActive } from '@angular/router';
import { NavigationBarComponent } from "./navigation-bar/navigation-bar.component";

@Component({
  selector: 'app-root',
  // standalone: true,
  imports: [RouterOutlet, RouterLinkWithHref, RouterLinkActive, NavigationBarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'WebsiteAngular';
}
