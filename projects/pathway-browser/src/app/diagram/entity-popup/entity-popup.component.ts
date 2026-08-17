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
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { CONTENT_SERVICE } from '../../../environments/environment';
import { SchemaClasses } from '../../constants/constants';
import { PropertyType } from '../../details/tabs/molecule-tab/molecule-tab.component';

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
  /** Secondary text: a species, or an interaction's evidence count and score. */
  detail?: string;
  /** Diagram entity or pathway to go to when clicked. */
  stId?: string;
  /** External link, for interactors. */
  href?: string;
}

/** Rows under an optional heading. Only the Molecules tab groups its rows. */
interface PopupGroup {
  label?: string;
  rows: PopupRow[];
}

/**
 * Molecule type of a component, where its own schema class settles it.
 *
 * Returns undefined for EntityWithAccessionedSequence, which covers proteins,
 * DNA and RNA alike; those need the reference entity to tell apart, and
 * guessing is how an earlier attempt labelled "BBC3 gene" a protein.
 */
function typeFromSchemaClass(schemaClass?: string): string | undefined {
  switch (schemaClass) {
    case SchemaClasses.SIMPLE_ENTITY:
      return PropertyType.CHEMICAL_COMPOUNDS;
    case SchemaClasses.DRUG:
    case SchemaClasses.CHEMICAL_DRUG:
    case SchemaClasses.PROTEIN_DRUG:
    case SchemaClasses.RNA_DRUG:
      return PropertyType.DRUG;
    case SchemaClasses.EWAS:
      return undefined;
    default:
      return PropertyType.OTHERS;
  }
}

/** Molecule type from a reference entity's schema class. */
function typeFromReferenceClass(referenceClass?: string): string {
  switch (referenceClass) {
    case 'ReferenceGeneProduct':
    case 'ReferenceIsoform':
      return PropertyType.PROTEINS;
    case 'ReferenceDNASequence':
    case 'ReferenceRNASequence':
      return PropertyType.SEQUENCES;
    case 'ReferenceMolecule':
      return PropertyType.CHEMICAL_COMPOUNDS;
    case 'ReferenceTherapeutic':
      return PropertyType.DRUG;
    default:
      return PropertyType.OTHERS;
  }
}

/** Display order, so headings do not jump around between entities. */
const TYPE_ORDER: string[] = [
  PropertyType.PROTEINS,
  PropertyType.SEQUENCES,
  PropertyType.CHEMICAL_COMPOUNDS,
  PropertyType.DRUG,
  PropertyType.OTHERS,
];

/**
 * The right-click inspector on diagram entities.
 *
 * Modelled on the popup in the current production Pathway Browser: titled with
 * the entity, Molecules / Pathways / Interactors as tabs down the side, and
 * their contents rendered **in place** rather than sending you off to the
 * details panel. Keeping the answer on the diagram is the point of it -- an
 * earlier attempt that merely deep linked into the details panel read, to
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

  /** A row was chosen; the diagram decides whether to select or navigate. */
  readonly navigate = output<{ stId: string; kind: EntityPopupTab }>();
  /** The title was clicked: return the diagram to the entity this is about. */
  readonly recenter = output<void>();
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
  // one request rather than three.

  private readonly molecules = rxResource({
    params: () => (this.tab() === 'molecules' ? this.target()?.stId : undefined),
    stream: ({ params }) =>
      params
        ? this.http.get<any>(`${CONTENT_SERVICE}/data/query/enhanced/${params}`).pipe(
            switchMap((entity) => {
              const components = [
                ...(entity?.hasComponent ?? []),
                ...(entity?.hasMember ?? []),
                ...(entity?.hasCandidate ?? []),
              ].filter((c) => c && typeof c === 'object');

              // A protein or small molecule has no components; show itself so
              // the tab is never mysteriously blank.
              const source = components.length > 0 ? components : entity ? [entity] : [];

              // Only EntityWithAccessionedSequence needs a second look, and an
              // entity typically has none or one of those, so this is a request
              // or two rather than one per row.
              const ambiguous = source.filter(
                (c: any) => c.schemaClass === SchemaClasses.EWAS && c.stId
              );
              if (ambiguous.length === 0) return of(this.group(source, new Map()));

              return forkJoin(
                ambiguous.map((c: any) =>
                  this.http.get<any>(`${CONTENT_SERVICE}/data/query/${c.stId}`).pipe(
                    map(
                      (full) =>
                        [c.stId, full?.referenceEntity?.schemaClass] as [string, string | undefined]
                    ),
                    // One failed lookup should not empty the whole tab; that
                    // row just falls back to Others.
                    catchError(() => of([c.stId, undefined] as [string, string | undefined]))
                  )
                )
              ).pipe(map((pairs) => this.group(source, new Map(pairs))));
            })
          )
        : of<PopupGroup[] | undefined>(undefined),
  });

  /** Group components by molecule type, in a stable order, as production does. */
  private group(
    components: any[],
    referenceClasses: Map<string, string | undefined>
  ): PopupGroup[] {
    const byType = new Map<string, PopupRow[]>();

    for (const component of components) {
      const label = component.displayName ?? component.name?.[0] ?? component.stId;
      // Components occasionally come back without a name; a blank row is worse
      // than no row.
      if (!label) continue;

      const type =
        typeFromSchemaClass(component.schemaClass) ??
        typeFromReferenceClass(referenceClasses.get(component.stId));

      const rows = byType.get(type) ?? [];
      rows.push({ label, stId: component.stId });
      byType.set(type, rows);
    }

    return [...byType.entries()]
      .sort(([a], [b]) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b))
      .map(([label, rows]) => ({ label, rows }));
  }

  private readonly pathways = rxResource({
    params: () => (this.tab() === 'pathways' ? this.target()?.stId : undefined),
    stream: ({ params }) =>
      params
        ? this.http.get<any[]>(`${CONTENT_SERVICE}/data/pathways/low/entity/${params}`).pipe(
            map((items): PopupGroup[] => [
              {
                rows: (items ?? []).map((p) => ({
                  label: p.displayName,
                  detail: p.speciesName,
                  stId: p.stId,
                })),
              },
            ])
          )
        : of<PopupGroup[] | undefined>(undefined),
  });

  private readonly interactors = rxResource({
    params: () => (this.tab() === 'interactors' ? this.target()?.acc : undefined),
    stream: ({ params }) =>
      params
        ? this.http
            .get<any>(`${CONTENT_SERVICE}/interactors/static/molecule/${params}/details`)
            .pipe(
              map((result): PopupGroup[] => [
                {
                  // Production lists evidence count alongside the score, and
                  // both matter when judging an interaction.
                  rows: (result?.entities?.[0]?.interactors ?? []).map((i: any) => ({
                    label: i.alias || i.acc,
                    detail: [
                      i.evidences != null ? `${i.evidences} evidence` : null,
                      i.score != null ? `score ${i.score}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    href: i.accURL,
                  })),
                },
              ])
            )
        : of<PopupGroup[] | undefined>(undefined),
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

  readonly groups = computed(() => (this.active().value() ?? []).filter((g) => g.rows.length > 0));
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
        return 'Not present in any other pathway.';
      case 'interactors':
        return 'No interactors to display.';
      default:
        return 'No component molecules.';
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
