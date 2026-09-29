import {
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { DiagramComponent } from '../../pathway-browser/src/app/diagram/diagram.component';
import { DataStateService } from '../../pathway-browser/src/app/services/data-state.service';
import { EventService } from '../../pathway-browser/src/app/services/event.service';
import { MemoryState } from './memory-state';
import { embedProviders } from './embed-providers';

type Status = 'loading' | 'drawn' | 'not-found';

/**
 * `<reactome-diagram pathway="R-HSA-…">`: one live pathway diagram, for other
 * sites' pages. The contract is specs/009-embeddable-diagram/contracts.
 *
 * Shadow DOM, so the partner's styles and ours stay apart; its own injector
 * (embedProviders), so it never reads or writes the partner's address and two
 * diagrams on a page are independent.
 */
@Component({
  selector: 'reactome-diagram-view',
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [DiagramComponent],
  providers: embedProviders,
  styleUrl: './diagram-element.component.scss',
  template: `
    <div class="frame">
      @if (pathwayId(); as id) {
        <cr-diagram
          [pathwayId]="id"
          (pathwayIdChange)="pathwayId.set($event)"
          (diagramLoaded)="loaded($event)"
          (diagramFailed)="failed($event)"
        />
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

  /** The pathway to show: a stable id, or a dbId, which is normalised. */
  readonly pathway = input<string | null>(null);

  protected readonly pathwayId = this.state.pathwayId;
  protected readonly status = signal<Status>('loading');
  private readonly diagram = viewChild(DiagramComponent);

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

    this.keepHitTestingAfterScroll();
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
