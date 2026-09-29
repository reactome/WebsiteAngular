import {
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import type cytoscape from 'cytoscape';
import { ReactomeEventTypes } from 'reactome-cytoscape-style';
import { DiagramComponent } from '../../pathway-browser/src/app/diagram/diagram.component';
import { IllustrationComponent } from './illustration.component';
import { DataStateService } from '../../pathway-browser/src/app/services/data-state.service';
import { EventService } from '../../pathway-browser/src/app/services/event.service';
import { DarkService } from '../../pathway-browser/src/app/services/dark.service';
import { HierarchyHoverService } from '../../pathway-browser/src/app/services/hierarchy-hover.service';
import { Analysis } from '../../pathway-browser/src/app/model/analysis.model';
import { MemoryState } from './memory-state';
import { embedProviders } from './embed-providers';

type Status = 'loading' | 'drawn' | 'not-found';
type Kind = 'diagram' | 'illustration';

/** An entity as the element's events describe it (contracts: `entityselected`). */
interface EntityDetail {
  id: string | null;
  name: string | null;
  schemaClass: string | null;
}
const NOTHING: EntityDetail = { id: null, name: null, schemaClass: null };

/** The events the wrapper element sends its view for `fit()` and `resetSelection()`. */
export const FIT_EVENT = 'reactome-diagram-fit';
export const CLEAR_SELECTION_EVENT = 'reactome-diagram-clear-selection';
/** `highlight(id)` sends the id as the event's detail; `resetHighlight()` sends none. */
export const HIGHLIGHT_EVENT = 'reactome-diagram-highlight';

/**
 * `<reactome-diagram pathway="R-HSA-…">`: one live pathway diagram, for other
 * sites' pages. The contract is specs/009-embeddable-diagram/contracts.
 *
 * Shadow DOM, so the partner's styles and ours stay apart; its own injector
 * (embedProviders), so it never reads or writes the partner's address and two
 * diagrams on a page are independent. What the partner sets -- a selection, a
 * flag, an analysis result, a theme -- goes into that injector's in-memory
 * state, where the diagram reads it exactly as it reads the site's address.
 */
@Component({
  selector: 'reactome-diagram-view',
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [DiagramComponent, IllustrationComponent],
  providers: embedProviders,
  styleUrl: './diagram-element.component.scss',
  host: {
    '[class.dark]': "theme() === 'dark'",
    [`(${FIT_EVENT})`]: 'fit()',
    [`(${CLEAR_SELECTION_EVENT})`]: 'clearSelection()',
    [`(${HIGHLIGHT_EVENT})`]: 'highlight($event)',
  },
  template: `
    <div class="frame">
      @if (pathwayId(); as id) {
        @if (kind() === 'illustration') {
          @defer (on immediate) {
            <reactome-illustration
              #illustration
              [pathwayId]="id"
              (pathwayIdChange)="pathwayId.set($event)"
              (illustrationLoaded)="loaded($event)"
              (illustrationFailed)="failed($event)"
            />
          }
        } @else if (kind() === 'diagram' && diagramId(); as shown) {
          <cr-diagram
            [pathwayId]="shown"
            (pathwayIdChange)="pathwayId.set($event)"
            (diagramLoaded)="loaded($event)"
            (diagramFailed)="failed($event)"
          />
        }
      }
      @if (status() === 'not-found') {
        <p class="message" role="status">This pathway could not be shown.</p>
      }
    </div>
  `,
})
export class DiagramElementComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly state = inject(MemoryState);
  private readonly dataState = inject(DataStateService);
  private readonly events = inject(EventService);
  private readonly dark = inject(DarkService);
  private readonly hierarchyHover = inject(HierarchyHoverService);

  /** The pathway to show: a stable id, or a dbId, which is normalised. */
  readonly pathway = input<string | null>(null);
  /** The entity to select and bring into view, by stable id. */
  readonly select = input<string | null>(null);
  /** A term whose matching entities are flagged, as the Pathway Browser's flag. */
  readonly flag = input<string | null>(null);
  /** An AnalysisService result to overlay. Read only: nothing is submitted. */
  readonly analysisToken = input<string | null>(null);
  /** The resource the overlay is filtered to; the service's TOTAL when unset. */
  readonly analysisResource = input<string | null>(null);
  /** `light` (the default) or `dark`. */
  readonly theme = input<string | null>(null);

  protected readonly pathwayId = this.state.pathwayId;
  protected readonly status = signal<Status>('loading');
  /** The term the partner flagged, while it is flagged. */
  private readonly partnerFlag = signal<string | null>(null);
  private readonly diagram = viewChild(DiagramComponent);
  // By template reference, not by class: a query naming the class is a static
  // import of it, which put the whole illustration back in the main bundle
  // that @defer keeps it out of.
  private readonly illustration = viewChild<{ fit(): void }>('illustration');

  /** The pathway lookup, when it is for the pathway being shown. */
  private readonly lookedUp = () => {
    const pathway = this.dataState.currentPathway();
    const id = this.pathwayId();
    return pathway && (pathway.stId === id || String(pathway.dbId) === id) ? pathway : undefined;
  };

  /**
   * What the pathway is drawn as, once its own lookup says -- and kept through a
   * switch until then, or every pathway change would tear the drawing down and
   * build it again.
   */
  protected readonly kind = linkedSignal<ReturnType<typeof this.lookedUp>, Kind | undefined>({
    source: this.lookedUp,
    computation: (pathway, previous) =>
      pathway ? (pathway.hasEHLD ? 'illustration' : 'diagram') : previous?.value,
  });

  /**
   * The pathway the diagram is given: the one shown, once its lookup says it is
   * a diagram. Given the next id straight away, the diagram fetched that
   * pathway's layout before knowing it had an illustration instead -- a false
   * diagramerror, or a drawing flashed up and reported, then replaced.
   */
  protected readonly diagramId = linkedSignal<ReturnType<typeof this.lookedUp>, string | undefined>(
    {
      source: this.lookedUp,
      computation: (pathway, previous) =>
        pathway && !pathway.hasEHLD ? this.pathwayId() : previous?.value,
    }
  );

  /**
   * The selection the partner's attribute has just made, not yet seen by the
   * report: it is not the reader's. Consumed once, so a later deselect or a
   * return to the same entity by the reader is reported.
   */
  private selectFromAttribute: { value: string | null } | undefined;

  constructor() {
    effect(() => {
      const requested = this.pathway();
      untracked(() => {
        this.status.set('loading');
        if (!requested) return this.state.pathwayId.set(undefined);
        const id = /^\d+$/.test(requested) ? Number(requested) : requested;
        void this.state.ensureStId(id).then((stId) => this.state.pathwayId.set(stId));
      });
    });

    // The diagram waits for its pathway's event (EventService.diagramPathway$),
    // which in the browser the viewport supplies.
    effect(() => {
      const pathway = this.dataState.currentPathway();
      if (pathway) this.events.setDiagramPathway(pathway);
    });

    // An id the service does not know never produces the pathway the diagram
    // waits for, so without this the box stayed blank for good -- no message,
    // no event. The lookup failing, or finishing empty, is the answer.
    effect(() => {
      const lookup = this.dataState._currentPathway;
      const settled =
        lookup.status() === 'error' || (lookup.status() === 'resolved' && !lookup.value());
      const id = untracked(() => this.state.pathwayId());
      if (settled && id && untracked(() => this.status()) === 'loading') this.failed(id);
    });

    this.followAttributes();
    this.reportClears();
    this.reportSelection();
    this.reportHover();
    this.keepHitTestingAfterScroll();
  }

  /** Fits the whole diagram in view (the element's `fit()`). */
  fit() {
    if (this.kind() === 'illustration') return this.illustration()?.fit();
    // Not before it has drawn: there is nothing to fit, and cytoscape is not there.
    if (this.diagram()?.cy) this.diagram()?.fitScreen();
  }

  /**
   * Clears the selection (the element's `resetSelection()`), whoever made it:
   * one the reader clicked has no attribute to remove.
   */
  clearSelection() {
    this.state.select.set(null);
    this.diagram()?.cy?.elements(':selected').unselect();
  }

  /**
   * Makes an entity stand out without selecting it (the element's
   * `highlight(id)`; `resetHighlight()` sends no id), the way the Pathway
   * Browser marks what is pointed at in its hierarchy: the rest fades. That
   * path, not the pointer's own hover, because the reader's pointer leaving a
   * node clears a hover -- and it reaches an illustration's regions too.
   */
  highlight(event: Event) {
    const id =
      event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : undefined;
    this.hierarchyHover.enter(id);
  }

  protected loaded(pathway: string) {
    this.status.set('drawn');
    this.emit('diagramloaded', { pathway });
  }

  protected failed(pathway: string) {
    // Two routes reach here for one failure -- the lookup settling empty, and
    // the diagram's own load failing -- and the partner should hear it once.
    if (this.status() === 'not-found' && this.state.pathwayId() === pathway) return;
    this.status.set('not-found');
    this.emit('diagramerror', { pathway, reason: 'not-found' });
  }

  /** The partner's attributes, into the state the diagram reads. */
  private followAttributes() {
    effect(() => {
      const select = this.select();
      untracked(() => {
        this.selectFromAttribute = { value: select };
        this.state.select.set(select);
        // The diagram draws a selection when there is one, and leaves the last
        // one drawn when there is none -- which removing the attribute has to
        // undo: the contract clears it, whoever made it.
        if (!select) this.diagram()?.cy?.elements(':selected').unselect();
      });
    });
    effect(() => {
      const flag = this.flag()?.trim();
      untracked(() => {
        // Only a new term is recorded here. Removing the attribute leaves the
        // old one, for the check below to see it go and report it.
        if (flag) this.partnerFlag.set(flag);
        this.state.flag.set(flag ? [flag] : []);
      });
    });
    effect(() => {
      const token = this.analysisToken();
      untracked(() => this.state.analysis.set(token || null));
    });
    effect(() => {
      const resource = this.analysisResource();
      untracked(() =>
        this.state.resourceFilter.set((resource || null) as Analysis.Resource | null)
      );
    });
    effect(() => {
      const dark = this.theme() === 'dark';
      untracked(() => this.dark.isDark.set(dark));
    });
  }

  /**
   * `flagcleared` when the partner's flag is no longer flagged, and
   * `analysiscleared` when the overlay goes: whoever did it, the partner's code
   * or the reader.
   */
  private reportClears() {
    // The partner's flag, gone: removed, cleared from the diagram's banner, or
    // replaced -- a legend entry flags its class in its place.
    effect(() => {
      const term = this.partnerFlag();
      const flags = this.state.flag();
      untracked(() => {
        if (term && !flags.includes(term)) {
          this.partnerFlag.set(null);
          this.emit('flagcleared', {});
        }
      });
    });
    let analysed = false;
    effect(() => {
      const now = !!this.state.analysis();
      if (analysed && !now) this.emit('analysiscleared', {});
      analysed = now;
    });
  }

  /**
   * `entityselected`, for what the reader selects -- not what the partner set.
   *
   * Clicking one entity while another is selected is two changes in the
   * diagram: the old one cleared, then the new one set 5ms later. Reported as
   * they happen, that told the partner nothing was selected in between. So a
   * change is reported a moment later, as whatever is selected by then, and
   * only if that differs from what was last reported.
   */
  private reportSelection() {
    let reported: string | null = null;
    let pending: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      this.state.select();
      untracked(() => {
        clearTimeout(pending);
        pending = setTimeout(() => {
          // What is selected now, not what was when this was scheduled: the
          // signal has its next value before this effect runs for it.
          const now = this.state.select();
          const fromAttribute = this.selectFromAttribute;
          this.selectFromAttribute = undefined;
          if (fromAttribute?.value === now) {
            reported = now;
            return;
          }
          if (now === reported) return;
          reported = now;
          this.emit('entityselected', now ? this.describe(now) : NOTHING);
        }, 20);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(pending));
  }

  /** `entityhovered`: the pointer entering an entity, and leaving it. */
  private reportHover() {
    effect((onCleanup) => {
      const diagram = this.diagram();
      if (!diagram) return;
      const subscription = diagram.reactomeEvents$.subscribe((event) => {
        if (event.detail.cy === diagram.legend) return;
        if (event.type === ReactomeEventTypes.hover) {
          const detail = this.detailOf(event.detail.element);
          // A compartment has no stable id, and id: null is what leaving says.
          if (detail.id) this.emit('entityhovered', detail);
        } else if (event.type === ReactomeEventTypes.leave) {
          this.emit('entityhovered', NOTHING);
        }
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  private describe(stId: string): EntityDetail {
    const cy = this.diagram()?.cy;
    const [node] = cy ? cy.elements().filter((e) => e.data('graph.stId') === stId) : [];
    if (node) return this.detailOf(node);
    // An illustration's regions, and anything not drawn, are the pathway's own
    // events.
    const event = this.dataState
      .currentPathway()
      ?.events?.find((e) => e.element.stId === stId)?.element;
    return { id: stId, name: event?.displayName ?? null, schemaClass: event?.schemaClass ?? null };
  }

  private detailOf(element: cytoscape.SingularElementArgument): EntityDetail {
    const text = (key: string) => {
      const value: unknown = element.data(key);
      return typeof value === 'string' ? value : null;
    };
    return {
      id: text('graph.stId'),
      name: text('displayName'),
      schemaClass: text('graph.schemaClass'),
    };
  }

  private emit(name: string, detail: object) {
    // From the element the partner placed, whose shadow root holds this view.
    const root = this.host.nativeElement.getRootNode();
    const target = root instanceof ShadowRoot ? root.host : this.host.nativeElement;
    target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /**
   * Cytoscape caches where its container is on the page, and clears that cache
   * on the scroll events of each ancestor -- found by walking parentNode, which
   * stops at our shadow root. Without this, after the partner's page scrolls a
   * click lands where the diagram used to be, and selects nothing.
   */
  private keepHitTestingAfterScroll() {
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.diagram()?.cy?.resize();
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('scroll', onScroll, { capture: true })
    );
  }
}
