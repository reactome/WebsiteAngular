import { Component, ViewChild, ElementRef } from '@angular/core';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-carousel',
  imports: [MatIcon],
  templateUrl: './carousel.component.html',
  styleUrl: './carousel.component.scss'
})
export class CarouselComponent {
  @ViewChild('carouselContainer') carouselContainer!: ElementRef<HTMLDivElement>;

  scrollLeft(): void {
    const container = this.carouselContainer.nativeElement;
    container.scrollBy({ left: -container.clientWidth, behavior: 'smooth' });
  }

  scrollRight(): void {
    const container = this.carouselContainer.nativeElement;
    container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
  }
}
