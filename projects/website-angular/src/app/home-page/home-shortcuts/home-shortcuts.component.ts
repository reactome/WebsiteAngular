import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";
import { mapNavOptions } from '../../../utils/nav-options-mapper';
import { NavOption } from '../../../types/link';

@Component({
  selector: 'app-home-shortcuts',
  imports: [CarouselComponent, ButtonComponent, MatIcon, RouterLink],
  templateUrl: './home-shortcuts.component.html',
  styleUrl: './home-shortcuts.component.scss'
})
export class HomeShortcutsComponent {
  navOptions: Record<string, NavOption> = {};
  @Input() dark:boolean = true;

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  resolveShortcutLink(link: string | undefined): string {
    if (!link) {
      return '';
    }

    if (/^(https?:)?\/\//.test(link) || link.startsWith('mailto:')) {
      return link;
    }

    return link.replace(/^\/+/, '');
  }
}
