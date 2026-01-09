import { Component } from '@angular/core';
import { RouterOutlet, RouterLinkWithHref, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLinkWithHref, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'WebsiteAngular';
}
