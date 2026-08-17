import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-carousel',
  imports: [MatIcon],
  templateUrl: './carousel.component.html',
  styleUrl: './carousel.component.scss',
})
export class CarouselComponent implements AfterViewInit, OnDestroy {
  @Input() dark: boolean = true;
  @ViewChild('carouselContainer') carouselContainer!: ElementRef<HTMLDivElement>;

  // Signals rather than plain fields: these are recomputed from a
  // ResizeObserver, which Angular has no visibility into. The observer used to
  // be wrapped in NgZone.run to get a re-render, but with zones off NgZone is a
  // no-op and the arrows would stop updating when the carousel resized.
  // Setting a signal notifies the views that read it either way, so the
  // NgZone dance is no longer needed at all.
  readonly showButtons = signal(true);
  readonly canScrollLeft = signal(false);
  readonly canScrollRight = signal(true);

  private resizeObserver?: ResizeObserver;

  @HostListener('window:resize')
  onWindowResize(): void {
    this.checkOverflow();
  }

  ngAfterViewInit(): void {
    // Deferred a tick so the projected content has been laid out and
    // scrollWidth is meaningful.
    setTimeout(() => this.checkOverflow());

    this.resizeObserver = new ResizeObserver(() => this.checkOverflow());
    this.resizeObserver.observe(this.carouselContainer.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onScroll(): void {
    this.updateScrollButtons();
  }

  private checkOverflow(): void {
    const el = this.carouselContainer.nativeElement;
    this.showButtons.set(el.scrollWidth > el.clientWidth);
    this.updateScrollButtons();
  }

  private updateScrollButtons(): void {
    const el = this.carouselContainer.nativeElement;
    this.canScrollLeft.set(el.scrollLeft > 0);
    this.canScrollRight.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
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
