import { Component, OnInit } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { NavLink } from '../../types/link';
import { EXTERNAL_LINKS } from '../../config/external-links'; // NEW import

@Component({
  selector: 'app-copyright-footer',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './copyright-footer.component.html',
  styleUrl: './copyright-footer.component.scss',
})
export class copyrightFooterComponent implements OnInit {
  externalLinks: Record<string, NavLink> = {};

  ngOnInit() {
    this.loadExternalLinks();
  }

  loadExternalLinks() {
    // Use the new TS constant instead of dynamic JSON import
    this.externalLinks = EXTERNAL_LINKS as unknown as Record<string, NavLink>;
  }
}
