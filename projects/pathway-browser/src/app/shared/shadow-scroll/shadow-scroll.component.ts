import {
  AfterViewInit,
  Component,
  ElementRef,
  input,
  linkedSignal,
  OnDestroy,
  viewChild,
  inject,
} from '@angular/core';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { KeyValuePipe, NgClass } from '@angular/common';
import { Subscription } from 'rxjs';

export type Side = 'top' | 'bottom' | 'left' | 'right';

@Component({
  selector: 'shadow-scroll',
  imports: [CdkScrollable, KeyValuePipe, NgClass],
  templateUrl: './shadow-scroll.component.html',
  styleUrl: './shadow-scroll.component.scss',
})
export class ShadowScrollComponent implements AfterViewInit, OnDestroy {
  elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly marginDetection = input(5);
  readonly scroll = viewChild.required(CdkScrollable);
  readonly height = input<number | undefined>(undefined);
  readonly width = input<number | undefined>(undefined);

  visibility = new Map<Side, boolean>([
    ['top', false],
    ['bottom', false],
    ['left', false],
    ['right', false],
  ]);

  readonly scrollDimensions = linkedSignal(() => this.getScrollDimensions());
  scrollDimensionsObserver = new ResizeObserver(() =>
    this.scrollDimensions.set(this.getScrollDimensions())
  );

  getScrollDimensions() {
    const scrollPanel = this.scroll().getElementRef().nativeElement;
    return {
      bottom: scrollPanel.offsetHeight - scrollPanel.clientHeight,
      right: scrollPanel.offsetWidth - scrollPanel.clientWidth,
    };
  }

  private onScroll!: Subscription;

  ngAfterViewInit(): void {
    this.resizeObserver.observe(this.scroll().getElementRef().nativeElement);
    this.updateShadows();
    this.onScroll = this.scroll()
      .elementScrolled()
      .subscribe(() => this.updateShadows());
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
    this.onScroll.unsubscribe();
  }

  private resizeObserver = new ResizeObserver(() => this.updateShadows());

  updateShadows() {
    this.visibility.forEach((_v, k) => {
      this.visibility.set(k, this.scroll().measureScrollOffset(k) > this.marginDetection());
    });
  }
}
