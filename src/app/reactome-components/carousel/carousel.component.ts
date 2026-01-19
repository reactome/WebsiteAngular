import { Component, ViewChild, ElementRef, Input } from '@angular/core';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-carousel',
  imports: [MatIcon],
  templateUrl: './carousel.component.html',
  styleUrl: './carousel.component.scss'
})
export class CarouselComponent {
  @Input() dark: boolean = true;
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
