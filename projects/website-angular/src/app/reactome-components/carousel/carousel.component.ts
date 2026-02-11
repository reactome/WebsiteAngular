import { Component, ViewChild, ElementRef, Input, AfterViewInit, OnDestroy, NgZone, HostListener, ChangeDetectorRef } from '@angular/core';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-carousel',
  imports: [MatIcon],
  templateUrl: './carousel.component.html',
  styleUrl: './carousel.component.scss'
})
export class CarouselComponent implements AfterViewInit, OnDestroy {
  @Input() dark: boolean = true;
  @ViewChild('carouselContainer') carouselContainer!: ElementRef<HTMLDivElement>;

  showButtons = true;
  canScrollLeft = false;
  canScrollRight = true;
  private resizeObserver?: ResizeObserver;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  @HostListener('window:resize')
  onWindowResize(): void {
    this.checkOverflow();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.checkOverflow();
      this.cdr.detectChanges();
    });
    this.ngZone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        this.ngZone.run(() => this.checkOverflow());
      });
      this.resizeObserver.observe(this.carouselContainer.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onScroll(): void {
    this.updateScrollButtons();
  }

  private checkOverflow(): void {
    const el = this.carouselContainer.nativeElement;
    this.showButtons = el.scrollWidth > el.clientWidth;
    this.updateScrollButtons();
  }

  private updateScrollButtons(): void {
    const el = this.carouselContainer.nativeElement;
    this.canScrollLeft = el.scrollLeft > 0;
    this.canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  scrollLeft(): void {
    const container = this.carouselContainer.nativeElement;
    container.scrollBy({ left: -container.clientWidth, behavior: 'smooth' });
  }

  scrollRight(): void {
    const container = this.carouselContainer.nativeElement;
    container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
  }
}
