import { AfterViewInit, Directive, ElementRef, inject, OnDestroy, output } from '@angular/core';

@Directive({
  selector: '[item-resize]',
})
export class ItemResizeObserverDirective implements AfterViewInit, OnDestroy {
  private el = inject(ElementRef);

  heightChange = output<number>();

  private ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      this.heightChange.emit(entry.contentRect.height);
    }
  });

  ngAfterViewInit() {
    this.ro.observe(this.el.nativeElement);
  }

  ngOnDestroy() {
    this.ro.disconnect();
  }
}
