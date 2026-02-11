import { Component } from '@angular/core';
import {ExternalLink, NavOption} from '../../../types/link';
import { mapNavOptions } from '../../../utils/nav-options-mapper';

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
    import('../../../config/external-links.json').then((data) => {
      this.externalLinks = mapNavOptions(data.default);
    });
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }
}
