import { Component } from '@angular/core';
import {ExternalLink, NavOption} from '../../../types/link';
import { mapNavOptions } from '../../../utils/nav-options-mapper';
import { EXTERNAL_LINKS } from '../../../config/external-links'; // NEW import

@Component({
  selector: 'app-home-why-reactome',
  standalone: true,
  imports: [],
  templateUrl: './home-why-reactome.component.html',
  styleUrl: './home-why-reactome.component.scss'
})
export class HomeWhyReactomeComponent {
  externalLinks: Record<string, ExternalLink> = {};
  navOptions: Record<string, NavOption> = {};

  ngOnInit() {
    this.loadExternalLinks();
    this.loadNavOptions();
  }

  loadExternalLinks() {
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, ExternalLink>;
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }
}
