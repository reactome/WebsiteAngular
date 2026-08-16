import {
  Component,
  ElementRef,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';

export type DiagramContextAction = 'molecule' | 'pathways' | 'interactors';

export interface DiagramContextTarget {
  /** Viewport coordinates of the click. The menu is positioned fixed, so these
   *  are used as-is and stay correct wherever the diagram sits on the page. */
  x: number;
  y: number;
  /** Stable id of the entity that was right-clicked. */
  stId: string;
  /** Entity name, shown as the menu heading so it is obvious what it acts on. */
  label: string;
}

/**
 * The right-click menu on diagram entities.
 *
 * Presentational only: it reports which item was chosen and leaves the
 * navigation to the diagram, which owns the selection state.
 */
@Component({
  selector: 'cr-diagram-context-menu',
  standalone: true,
  templateUrl: './diagram-context-menu.component.html',
  styleUrl: './diagram-context-menu.component.scss',
})
export class DiagramContextMenuComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly target = input<DiagramContextTarget | null>(null);

  readonly action = output<DiagramContextAction>();
  readonly dismissed = output<void>();

  private readonly items = viewChildren<ElementRef<HTMLButtonElement>>('item');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  /**
   * Where the menu is actually drawn. Entities near the right or bottom edge
   * would otherwise push it off screen, so once its real size is known it is
   * clamped back inside the viewport.
   */
  readonly position = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  constructor() {
    effect(() => {
      const target = this.target();
      if (!target) return;

      // Reading the viewChild makes this re-run once the menu exists in the
      // DOM, which is when it can be measured.
      const element = this.menu()?.nativeElement;
      if (!element) {
        this.position.set({ x: target.x, y: target.y });
        return;
      }

      const { width, height } = element.getBoundingClientRect();
      const margin = 8;
      this.position.set({
        x: Math.max(margin, Math.min(target.x, window.innerWidth - width - margin)),
        y: Math.max(margin, Math.min(target.y, window.innerHeight - height - margin)),
      });

      // Move focus into the menu so it can be driven from the keyboard, and so
      // Escape has somewhere to return from.
      this.items()[0]?.nativeElement.focus();
    });
  }

  choose(action: DiagramContextAction): void {
    this.action.emit(action);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.target()) this.dismissed.emit();
  }

  // A right-click elsewhere fires `contextmenu`, not `click`, so both are
  // needed to close the menu reliably.
  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  onDocumentPointer(event: Event): void {
    if (!this.target()) return;
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.dismissed.emit();
  }

  /** Roving focus, so arrow keys walk the menu like a real one. */
  onKeydown(event: KeyboardEvent, index: number): void {
    const buttons = this.items();
    if (buttons.length === 0) return;

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    buttons[(index + step + buttons.length) % buttons.length].nativeElement.focus();
  }
}
