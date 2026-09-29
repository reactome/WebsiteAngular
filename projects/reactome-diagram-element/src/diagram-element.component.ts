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
  },
  template: `
    <div class="frame">
      @if (pathwayId(); as id) {
        @if (kind() === 'illustration') {
          @defer (on immediate) {
            <reactome-illustration
              [pathwayId]="id"
              (pathwayIdChange)="pathwayId.set($event)"
              (illustrationLoaded)="loaded($event)"
              (illustrationFailed)="failed($event)"
            />
          }
        } @else if (kind() === 'diagram') {
          <cr-diagram
            [pathwayId]="id"
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
  private readonly diagram = viewChild(DiagramComponent);

  /**
   * What the pathway is drawn as. Kept through a switch until the next
   * pathway's own answer arrives: the lookup is empty in between, and following
   * it would tear the diagram down and build it again on every pathway change.
   */
  protected readonly kind = linkedSignal<
    ReturnType<typeof this.dataState.currentPathway>,
    Kind | undefined
  >({
    source: this.dataState.currentPathway,
    computation: (pathway, previous) =>
      pathway ? (pathway.hasEHLD ? 'illustration' : 'diagram') : previous?.value,
  });

  /** The last selection the partner set, so it is not reported as the reader's. */
  private selectFromAttribute: string | null | undefined;

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
    this.diagram()?.fitScreen();
  }

  /**
   * Clears the selection (the element's `resetSelection()`), whoever made it:
   * one the reader clicked has no attribute to remove.
   */
  clearSelection() {
    this.state.select.set(null);
    this.diagram()?.cy?.elements(':selected').unselect();
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
        this.selectFromAttribute = select;
        this.state.select.set(select);
        // The diagram draws a selection when there is one, and leaves the last
        // one drawn when there is none -- which removing the attribute has to
        // undo: the contract clears it, whoever made it.
        if (!select) this.diagram()?.cy?.elements(':selected').unselect();
      });
    });
    effect(() => {
      const flag = this.flag()?.trim();
      untracked(() => this.state.flag.set(flag ? [flag] : []));
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
   * `flagcleared` and `analysiscleared`: whenever the state goes from something
   * to nothing, whoever cleared it -- the partner's code, or the reader.
   */
  private reportClears() {
    let flagged = false;
    effect(() => {
      const now = this.state.flag().length > 0;
      if (flagged && !now) this.emit('flagcleared', {});
      flagged = now;
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
      const selected = this.state.select();
      untracked(() => {
        clearTimeout(pending);
        if (selected === this.selectFromAttribute) {
          reported = selected;
          return;
        }
        pending = setTimeout(() => {
          // What is selected now, not what was when this was scheduled: the
          // signal has its next value before this effect runs for it.
          const now = this.state.select();
          if (now === reported || now === this.selectFromAttribute) return;
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
          this.emit('entityhovered', this.detailOf(event.detail.element));
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
    return node ? this.detailOf(node) : { id: stId, name: null, schemaClass: null };
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
