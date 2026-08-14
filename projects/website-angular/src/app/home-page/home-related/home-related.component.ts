import { Component } from '@angular/core';
import {ExternalLink} from '../../../types/link';
import { EXTERNAL_LINKS } from '../../../config/external-links'; // NEW import

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
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, ExternalLink>;
  }
}
