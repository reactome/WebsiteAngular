import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CarouselComponent } from '../../reactome-components/carousel/carousel.component';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { MatIcon } from '@angular/material/icon';
import { mapNavOptions } from '../../../utils/nav-options-mapper';
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
  navOptions: Record<string, NavOption> = {};
  externalLinks: Record<string, ExternalLink> = {};
  releaseNotesLink: string = '';
  feedbackLink: string = '';

  ngOnInit() {
    this.loadNavOptions();
    this.loadExternalLinks();
  }
  
  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  loadExternalLinks() {
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, ExternalLink>;
    this.releaseNotesLink = this.externalLinks['releaseNotes']?.link || '';
    this.feedbackLink = this.externalLinks['feedback']?.link || '';
  }
}
