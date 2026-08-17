import {
  computed,
  Directive,
  effect,
  ElementRef,
  input,
  OnDestroy,
  Renderer2,
  inject,
} from '@angular/core';

type EventType = keyof HTMLElementEventMap;

@Directive({
  selector: '[passive]',
})
export class PassiveDirective implements OnDestroy {
  private element = inject(ElementRef);
  private renderer = inject(Renderer2);

  listeners = input.required<{
    [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
  }>({ alias: 'passive' });
  once = input(false);
  capture = input(false);

  options = computed(() => ({ passive: true, once: this.once(), capture: this.capture() }));

  private removers: (() => void)[] = [];

  constructor() {
    effect(() => {
      this.clear();
      const [listeners, options] = [this.listeners(), this.options()];
      if (!listeners) return console.warn('No listeners provided');
      this.removers = Object.entries(listeners).map(([type, listener]) =>
        this.renderer.listen(this.element.nativeElement, type, listener, options)
      );
    });
  }

  ngOnDestroy(): void {
    this.clear();
  }

  clear() {
    this.removers.forEach((remove) => remove());
    this.removers = [];
  }
}
