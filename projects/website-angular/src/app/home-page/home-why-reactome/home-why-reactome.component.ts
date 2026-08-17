import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject, OnInit } from '@angular/core';
import {ExternalLink, NavOption} from '../../../types/link';
import { EXTERNAL_LINKS } from '../../../config/external-links'; // NEW import

@Component({
  selector: 'app-home-why-reactome',
  standalone: true,
  imports: [],
  templateUrl: './home-why-reactome.component.html',
  styleUrl: './home-why-reactome.component.scss'
})
export class HomeWhyReactomeComponent implements OnInit {
  externalLinks: Record<string, ExternalLink> = {};
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;

  ngOnInit() {
    this.loadExternalLinks();
  }

  loadExternalLinks() {
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, ExternalLink>;
  }
}
