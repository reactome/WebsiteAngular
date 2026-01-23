import { Component } from '@angular/core';
import { MatIcon } from "@angular/material/icon";
import NavLink from '../../types/nav-link';

@Component({
  selector: 'app-copyright-footer',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './copyright-footer.component.html',
  styleUrl: './copyright-footer.component.scss'
})
export class copyrightFooterComponent {
   externalLinks:Record<string, NavLink> = {}

   ngOnInit() {
    this.loadExternalLinks();
   }

   loadExternalLinks() {
    // Load external links from the JSON file
    import('../../config/external-links.json').then((data) => {
      this.externalLinks = data.default;
    });
   }
}
