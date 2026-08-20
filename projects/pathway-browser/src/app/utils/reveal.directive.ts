import { Directive, effect, ElementRef, inject, input } from '@angular/core';

/**
 * Scrolls its element into view when it becomes the thing worth looking at.
 *
 * ```html
 * <li [crReveal]="node.stId === selected()">…</li>
 * ```
 *
 * This started as the event hierarchy revealing the selected event, done by
 * `document.querySelector` from the component after the tree finished building.
 * Three other places had grown their own copy, each with slightly different
 * behaviour and each coupled to an id convention in a template it did not own.
 * As a directive, the element that knows it is selected reveals itself, and the
 * timing follows rendering rather than a guess about it.
 *
 * The scrolling itself is the part worth keeping identical everywhere:
 *
 * `block: 'nearest'` scrolls the minimum needed and does nothing at all when the
 * element is already visible. The default, `'start'`, pulls the element to the
 * top of its container on every change -- which is what "the hierarchy jumps to
 * the top" was -- and because scrollIntoView walks every scrollable ancestor, it
 * drags the whole page along with it.
 */
@Directive({
  selector: '[crReveal]',
})
export class RevealDirective {
  private element = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Whether this element is the one to bring into view. */
  readonly reveal = input.required<boolean>({ alias: 'crReveal' });

  /**
   * Where to put it. 'nearest' means "only if it is not already visible", which
   * is what almost every caller wants; 'start' is for a list where the selected
   * row is meant to land at the top.
   */
  readonly block = input<ScrollLogicalPosition>('nearest', { alias: 'crRevealBlock' });

  constructor() {
    effect((onCleanup) => {
      if (!this.reveal()) return;

      // Two frames, not now and not one. One frame is enough for the element to
      // exist, and not enough for it to be where it will end up: a row in a
      // table that is still expanding rows, or paging to a different page, moves
      // after the first frame. Revealing then left it 28px past the edge of its
      // container. The second frame is after that layout has been painted.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          this.element.nativeElement.scrollIntoView({
            // Someone who has asked their system for less motion has asked for
            // less motion.
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth',
            block: this.block(),
            inline: 'nearest',
          });
        });
      });
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }
}
