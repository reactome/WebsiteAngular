import { Component } from '@angular/core';
import ExternalLink from '../../../types/external-link';

@Component({
  selector: 'app-home-related',
  standalone: true,
  imports: [],
  templateUrl: './home-related.component.html',
  styleUrl: './home-related.component.scss'
})
export class HomeRelatedComponent {
  externalLinks: Record<string, ExternalLink> = {};

  ngOnInit() {
    this.loadExternalLinks();
  }

  loadExternalLinks() {
    import('../../../config/external-links.json').then((data) => {
      this.externalLinks = data.default;
    });
  }
}
