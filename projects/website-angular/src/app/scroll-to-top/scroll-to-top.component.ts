import { Component, HostListener, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-scroll-to-top',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './scroll-to-top.component.html',
  styleUrl: './scroll-to-top.component.scss',
})
export class ScrollToTopComponent {
  // Source - https://stackoverflow.com/a
  // Posted by Ashish Dahiya
  // Retrieved 2026-01-12, License - CC BY-SA 4.0

  /**
   * Whether the page is scrolled away from the top, which is what reveals the
   * button.
   *
   * A signal rather than a plain field, and a HostListener rather than a bare
   * `window.addEventListener`, because both are needed without zone.js: a
   * listener registered directly on window is invisible to Angular, so the
   * assignment used to update nothing and the button never appeared. Angular
   * also tears a HostListener down with the component, which the manual
   * listener never did.
   */
  readonly windowScrolled = signal(false);

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.windowScrolled.set(window.scrollY !== 0);
  }

  scrollToTop(): void {
    window.scrollTo(0, 0);
  }
}
