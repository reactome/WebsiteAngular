import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from "@angular/material/icon";
import {NavLink} from '../../types/link';
import { mapNavOptions } from '../../utils/nav-options-mapper';

@Component({
  selector: 'app-copyright-footer',
  standalone: true,
  imports: [CommonModule, MatIcon],
  templateUrl: './copyright-footer.component.html',
  styleUrl: './copyright-footer.component.scss'
})
export class copyrightFooterComponent implements OnInit {
   externalLinks:Record<string, NavLink> = {}

   ngOnInit() {
    this.loadExternalLinks();
   }

   loadExternalLinks() {
    // Load external links from the JSON file
    import('../../config/external-links.json').then((data) => {
      this.externalLinks = mapNavOptions(data.default);
    });
   }
}
