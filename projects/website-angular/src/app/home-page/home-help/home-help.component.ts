import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CarouselComponent } from '../../reactome-components/carousel/carousel.component';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { MatIcon } from '@angular/material/icon';
import { ExternalLink, NavOption } from '../../../types/link';
import { EXTERNAL_LINKS } from '../../../config/external-links'; // NEW import

@Component({
  selector: 'app-home-help',
  standalone: true,
  imports: [CarouselComponent, ButtonComponent, MatIcon, RouterLink],
  templateUrl: './home-help.component.html',
  styleUrl: './home-help.component.scss'
})
export class HomeHelpComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
  externalLinks: Record<string, ExternalLink> = {};
  releaseNotesLink: string = '';
  feedbackLink: string = '';

  ngOnInit() {
    this.loadExternalLinks();
  }

  loadExternalLinks() {
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, ExternalLink>;
    this.releaseNotesLink = this.externalLinks['releaseNotes']?.link || '';
    this.feedbackLink = this.externalLinks['feedback']?.link || '';
  }
}
