import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, Input, inject } from '@angular/core';
import { CarouselComponent } from '../../reactome-components/carousel/carousel.component';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { MatIcon } from '@angular/material/icon';
import { NavOption } from '../../../types/link';
import { environment } from '../../../../../pathway-browser/src/environments/environment';

@Component({
  selector: 'app-curator-home-shortcuts',
  imports: [CarouselComponent, ButtonComponent, MatIcon],
  templateUrl: './curator-home-shortcuts.component.html',
  styleUrl: './curator-home-shortcuts.component.scss',
})
export class CuratorHomeShortcutsComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
  @Input() dark: boolean = true;
  // WebBench is a separate app deployed alongside the curator site, so it has
  // no local equivalent: keying this off window.location.origin pointed it at
  // the dev server (http://localhost:4200/curatortool/home, a 404). Build it
  // from environment.host so it always resolves to the deployed WebBench.
  readonly webbenchLink = `${environment.host}/curatortool/home`;

  // The curator build's baseHref is "/curatorgraph/", not "/". A plain
  // absolute href like "/about" would ignore that base and 404; strip the
  // leading slash so the browser resolves it relative to the current
  // (already-base-prefixed) page instead.
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
