import { HttpClient } from '@angular/common/http';
import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { map } from 'rxjs/operators';
import { CONTENT_SERVICE } from '../../../environments/environment';

export type EntityPopupTab = 'molecules' | 'pathways' | 'interactors';

export interface EntityPopupTarget {
  /** Viewport coordinates of the right-click; the popup is positioned fixed. */
  x: number;
  y: number;
  /** Stable id of the entity that was right-clicked. */
  stId: string;
  /** Entity name, shown as the popup title. */
  label: string;
  /** UniProt/ChEBI accession, where the entity has one. Only entities with an
   *  accession can have interactors looked up. */
  acc?: string;
}

/** One row of any of the three lists, normalised so the template stays simple. */
interface PopupRow {
  label: string;
  /** Secondary text: a compartment, a species, or an interaction score. */
  detail?: string;
  /** Diagram entity or pathway to go to when clicked. */
  stId?: string;
  /** External link, for interactors. */
  href?: string;
}

/**
 * The right-click inspector on diagram entities.
 *
 * Modelled on the popup in the current production Pathway Browser: it is
 * titled with the entity, has Molecules / Pathways / Interactors tabs down the
 * side, and shows their contents **in place** rather than sending you off to
 * the details panel. Keeping the answer on the diagram is the point of it --
 * an earlier attempt that merely deep linked into the details panel read, to
 * curators, as "it just changes the tab".
 */
@Component({
  selector: 'cr-entity-popup',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './entity-popup.component.html',
  styleUrl: './entity-popup.component.scss',
})
export class EntityPopupComponent {
  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly target = input<EntityPopupTarget | null>(null);

  /**
   * What the diagram is currently sitting on.
   *
   * The popup is a lens on one entity and the diagram is what moves, so this
   * is where the lens is presently pointed -- without it the popup cannot show
   * you where you are, and re-centring appears to do nothing.
   */
  readonly selected = input<string | null>(null);

  /** A row was chosen; the diagram decides whether to select or navigate. */
  readonly navigate = output<{ stId: string; kind: EntityPopupTab }>();
  readonly dismissed = output<void>();

  readonly tab = signal<EntityPopupTab>('molecules');
  /** Pinned popups survive clicks elsewhere, matching the production pin. */
  readonly pinned = signal(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  readonly position = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  readonly tabs: { id: EntityPopupTab; label: string; icon: string }[] = [
    { id: 'molecules', label: 'Molecules', icon: 'hub' },
    { id: 'pathways', label: 'Pathways', icon: 'account_tree' },
    { id: 'interactors', label: 'Interactors', icon: 'share' },
  ];

  constructor() {
    effect(() => {
      const target = this.target();
      if (!target) return;

      // Start each new entity on the first tab, as the production popup does.
      this.tab.set('molecules');
      this.pinned.set(false);

      // Reading the viewChild re-runs this once the panel is in the DOM and can
      // be measured, so it can be kept inside the viewport.
      const element = this.panel()?.nativeElement;
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
    });
  }

  // --- data ------------------------------------------------------------
  // Each tab loads only when it is the visible one, so opening the popup costs
  // a single request rather than three.

  private readonly molecules = rxResource({
    params: () => (this.tab() === 'molecules' ? this.target()?.stId : undefined),
    stream: ({ params }) =>
      params
        ? this.http.get<any>(`${CONTENT_SERVICE}/data/query/enhanced/${params}`).pipe(
            map((entity): PopupRow[] => {
              const components: any[] = entity?.hasComponent ?? entity?.hasMember ?? [];
              // A protein or small molecule has no components; show itself so
              // the tab is never mysteriously blank.
              const source = components.length > 0 ? components : entity ? [entity] : [];
              return source
                // No type label: displayName already carries the compartment,
                // and schemaClass cannot be turned into an accurate one --
                // EntityWithAccessionedSequence covers proteins, RNA and genes
                // alike, so "BBC3 gene" came out labelled "Protein".
                .map((c) => ({
                  label: c.displayName ?? c.name?.[0] ?? c.stId,
                  stId: c.stId,
                }))
                // Components occasionally come back without a name; a blank
                // row is worse than no row.
                .filter((row) => !!row.label);
            })
          )
        : of<PopupRow[] | undefined>(undefined),
  });

  private readonly pathways = rxResource({
    params: () => (this.tab() === 'pathways' ? this.target()?.stId : undefined),
    stream: ({ params }) =>
      params
        ? this.http
            .get<any[]>(`${CONTENT_SERVICE}/data/pathways/low/entity/${params}`)
            .pipe(
              map((items): PopupRow[] =>
                (items ?? []).map((p) => ({
                  label: p.displayName,
                  detail: p.speciesName,
                  stId: p.stId,
                }))
              )
            )
        : of<PopupRow[] | undefined>(undefined),
  });

  private readonly interactors = rxResource({
    params: () => (this.tab() === 'interactors' ? this.target()?.acc : undefined),
    stream: ({ params }) =>
      params
        ? this.http
            .get<any>(`${CONTENT_SERVICE}/interactors/static/molecule/${params}/details`)
            .pipe(
              map((result): PopupRow[] =>
                (result?.entities?.[0]?.interactors ?? []).map((i: any) => ({
                  label: i.alias || i.acc,
                  detail: i.score != null ? `score ${i.score}` : undefined,
                  href: i.accURL,
                }))
              )
            )
        : of<PopupRow[] | undefined>(undefined),
  });

  private readonly active = computed(() => {
    switch (this.tab()) {
      case 'pathways':
        return this.pathways;
      case 'interactors':
        return this.interactors;
      default:
        return this.molecules;
    }
  });

  readonly rows = computed(() => this.active().value() ?? []);
  readonly loading = computed(() => this.active().isLoading());
  readonly failed = computed(() => this.active().status() === 'error');

  /** Only entities carrying an accession can have interactors looked up. */
  readonly interactorsUnavailable = computed(
    () => this.tab() === 'interactors' && !this.target()?.acc
  );

  readonly emptyMessage = computed(() => {
    if (this.interactorsUnavailable()) return 'No accession for this entity, so no interactors.';
    switch (this.tab()) {
      case 'pathways':
        return 'Not found in any other pathway.';
      case 'interactors':
        return 'No interactors found.';
      default:
        return 'No component molecules.';
    }
  });

  /**
   * Rows that take you away from the diagram say so.
   *
   * Molecules keep you here and only move the view, so they get no icon; a
   * pathway replaces the diagram, and an interactor opens another site.
   */
  readonly rowIcon = computed(() => {
    switch (this.tab()) {
      case 'pathways':
        return 'arrow_forward';
      case 'interactors':
        return 'open_in_new';
      default:
        return null;
    }
  });

  // --- interaction -----------------------------------------------------

  select(tab: EntityPopupTab): void {
    this.tab.set(tab);
  }

  open(row: PopupRow): void {
    if (row.href) {
      window.open(row.href, '_blank', 'noopener');
      return;
    }
    if (row.stId) this.navigate.emit({ stId: row.stId, kind: this.tab() });
  }

  /** True for the row the diagram is currently sitting on. */
  isCurrent(row: PopupRow): boolean {
    return !!row.stId && row.stId === this.selected();
  }

  /** True when the row actually has somewhere to take you. */
  isNavigable(row: PopupRow): boolean {
    return !!row.stId || !!row.href;
  }

  /**
   * Point the diagram back at the entity the popup is about.
   *
   * The popup stays anchored while the diagram travels, so following a
   * component molecule is not a departure you undo -- it is the lens staying
   * put while the view moves. Re-centring is how you bring the view back, and
   * it is offered both on the title and as its own header button, because a
   * title that happens to be clickable is not an affordance anyone finds.
   *
   * Emitted as an entity rather than a pathway, because that is what it is --
   * the diagram selects and re-centres, exactly as it does for a row.
   */
  recentre(): void {
    const target = this.target();
    if (target) this.navigate.emit({ stId: target.stId, kind: 'molecules' });
  }

  close(): void {
    this.dismissed.emit();
  }

  togglePin(): void {
    this.pinned.update((v) => !v);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.target()) this.dismissed.emit();
  }

  // A right-click elsewhere fires `contextmenu` rather than `click`, so both
  // are needed to dismiss reliably.
  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  onDocumentPointer(event: Event): void {
    if (!this.target() || this.pinned()) return;
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.dismissed.emit();
  }
}
