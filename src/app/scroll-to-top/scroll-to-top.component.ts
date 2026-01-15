import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from "@angular/material/icon";
@Component({
  selector: 'app-scroll-to-top',
  standalone: true,
  imports: [CommonModule, MatIcon],
  templateUrl: './scroll-to-top.component.html',
  styleUrl: './scroll-to-top.component.scss'
})
export class ScrollToTopComponent {
  // Source - https://stackoverflow.com/a
  // Posted by Ashish Dahiya
  // Retrieved 2026-01-12, License - CC BY-SA 4.0

  scrollToTop(): void {
    window.scrollTo(0, 0);
  }


  windowScrolled = false;

  ngOnInit() {
    window.addEventListener('scroll', () => {
      this.windowScrolled = window.pageYOffset !== 0;
    });
  }

}
