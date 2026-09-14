import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  effect,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';
import {
  InteractorToken,
  PsicquicResource,
  ResourceAndType,
  ResourceType,
} from './model/interactor.model';
import cytoscape from 'cytoscape';
import { DiagramService } from '../services/diagram.service';
import { DarkService } from '../services/dark.service';
import { InteractorService } from './services/interactor.service';
import { UrlStateService } from '../services/url-state.service';
import { MatDialog } from '@angular/material/dialog';
import { CustomInteractorDialogComponent } from './custom-interactor-dialog/custom-interactor-dialog.component';
import { Subscription } from 'rxjs';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { MatDivider } from '@angular/material/divider';
import { MatGridList, MatGridTile } from '@angular/material/grid-list';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSelectionList, MatListOption } from '@angular/material/list';

@Component({
  selector: 'cr-interactors',
  templateUrl: './interactors.component.html',
  styleUrls: ['./interactors.component.scss'],
  standalone: true,
  imports: [
    MatCard,
    MatCardContent,
    MatButton,
    MatIconButton,
    MatIcon,
    NgClass,
    NgTemplateOutlet,
    MatDivider,
    MatGridList,
    MatGridTile,
    MatProgressSpinner,
    MatSelectionList,
    MatListOption,
  ],
})
export class InteractorsComponent implements AfterViewInit {
  private diagram: DiagramService = inject(DiagramService);
  public dark: DarkService = inject(DarkService);
  private interactors: InteractorService = inject(InteractorService);
  private state: UrlStateService = inject(UrlStateService);
  public dialog: MatDialog = inject(MatDialog);
  private cdr: ChangeDetectorRef = inject(ChangeDetectorRef);

  isDataFromPsicquicLoading: boolean = false;
  /**
   * Which resource is being fetched, so its own button can say so.
   *
   * The grid used to be hidden entirely while a fetch was in flight, so choosing
   * BioGrid made every resource button disappear and come back -- and the
   * per-button spinner could never appear, because the thing containing it was
   * gone whenever it would have been shown.
   */
  loadingResource: string | null = null;
  resourceTokens: InteractorToken[] = [];
  clear = false;
  psicquicResources: PsicquicResource[] = [];

  DISEASE_RESOURCE = 'DisGeNet';
  INTACT_RESOURCE = 'IntAct';
  protected readonly ResourceType = ResourceType;

  readonly hasEHLD = input<boolean>();
  readonly cy = input<cytoscape.Core>();
  readonly cys = input<cytoscape.Core[] | undefined>([]);
  readonly currentResource = this.interactors.currentResource;
  /** What each resource turned out to hold here, once we have asked it. */
  readonly resourceCounts = this.interactors.resourceCounts;
  @Output() initialiseReplaceElements: EventEmitter<any> = new EventEmitter();

  ngAfterViewInit(): void {
    this.getPsicquicResources();
  }

  constructor() {
    // The prefetch needs two things that arrive in either order: the resource
    // list, and a graph to ask about. ngAfterViewInit runs when this panel is
    // created, which is before the diagram exists -- so hanging the prefetch off
    // the resource list alone meant `cys()` was empty at the one moment it was
    // tried, and it silently never ran: no requests, no counts, no error.
    //
    // An effect on the graphs covers the other order, and maybePrefetchCounts is
    // idempotent, so whichever arrives second starts it.
    effect(() => {
      this.cys();
      this.maybePrefetchCounts();
    });
  }

  /**
   * Ask every live resource what it holds here, if we can and have not already.
   *
   * Cheap to call repeatedly: the service skips resources it has already
   * answered for this pathway.
   */
  private maybePrefetchCounts(attempt = 0): void {
    const graph = this.cys()?.[0];
    if (this.psicquicResources.length === 0) return;

    // The graph may not be there yet. This panel is created before the diagram
    // is, so the resource list routinely arrives first -- and hanging the
    // prefetch on that moment alone meant it ran once, found nothing to ask
    // about, and never tried again: no requests, no counts, and no error to
    // notice. An effect on `cys()` did not rescue it either.
    //
    // So it waits, briefly and a bounded number of times. Ten seconds is longer
    // than a diagram takes to draw, and if it is not there by then the reader
    // is looking at something else anyway.
    if (!graph) {
      if (attempt < 10) setTimeout(() => this.maybePrefetchCounts(attempt + 1), 1000);
      return;
    }

    this.interactors.prefetchResourceCounts(graph, [
      this.INTACT_RESOURCE,
      ...this.psicquicResources.map((resource) => resource.name),
    ]);
  }

  getInteractors(resource: string | null | InteractorToken) {
    if (!resource) return;

    // Clicking the chosen one puts it away. It is the obvious gesture -- click
    // the highlighted thing to un-highlight it -- and it did nothing at all, so
    // the only way out was the separate "Clear overlays" button, which is easy
    // to miss when the button you just pressed looks like it should work.
    // A custom resource is identified by its token, a named one by its name.
    const name = typeof resource === 'string' ? resource : resource.summary?.token;
    if (name && this.currentResource().name === name) {
      this.clearInteractors();
      return;
    }

    this.interactors.getResourceType(resource as string).subscribe({
      next: (resourceType) => {
        switch (resourceType) {
          case ResourceType.STATIC:
          case ResourceType.DISGENET:
            this.getStaticInteractors(resource as string);
            break;
          case ResourceType.PSICQUIC:
            this.getPsicquicResourceInteractors(resource as string);
            break;
          case ResourceType.CUSTOM:
            this.getCustomResourceInteractors(resource as InteractorToken);
            break;
          default:
            throw new Error('Unknown resource type encountered: ' + resourceType);
        }
      },

      error: (error) => {
        console.error('Error determining resource type:', error);
        throw new Error('Error determining resource type: ' + error);
      },
    });
  }

  getStaticInteractors(resource: string | null) {
    if (resource) {
      this.clear = false;
      const type = resource === ResourceType.STATIC ? ResourceType.STATIC : ResourceType.DISGENET;
      this.updateCurrentResource(resource, type);
    } else {
      return;
    }
    this.cys()?.forEach((cy) => {
      this.interactors.fetchInteractorData(cy, resource).subscribe((interactors) => {
        this.interactors.addInteractorOccurrenceNode(interactors, cy, resource);
        this.initialiseReplaceElements.emit();
      });
      this.state.overlay.set(resource);
    });
  }

  getPsicquicResourceInteractors(selectedResource: string) {
    this.isDataFromPsicquicLoading = true;
    this.loadingResource = selectedResource;
    this.clear = false;
    this.updateCurrentResource(selectedResource, ResourceType.PSICQUIC);
    this.cys()?.forEach((cy) => {
      this.interactors.fetchInteractorData(cy, selectedResource).subscribe((interactors) => {
        this.interactors.addInteractorOccurrenceNode(interactors, cy, selectedResource);
        this.isDataFromPsicquicLoading = false;
        this.loadingResource = null;
        this.state.overlay.set(selectedResource);
      });
    });
  }

  openCustomInteractorDialog() {
    this.cys()?.forEach((cy) => {
      // Avoid multiple opening dialogs
      if (this.dialog.openDialogs.length === 1) {
        return;
      }
      const dialogRef = this.dialog.open(CustomInteractorDialogComponent, {
        data: { cy: cy },
        restoreFocus: false, // Deselect button when closing
      });

      dialogRef.afterClosed().subscribe((result) => {
        const resource = dialogRef.componentInstance.token;
        if (resource) {
          this.resourceTokens!.push(resource);
          this.clear = false;
          this.updateCurrentResource(resource.summary.name, ResourceType.CUSTOM);
          this.state.overlay.set(resource.summary.token);
        }
        this.cdr.detectChanges();
      });
    });
  }

  isSelected(resource: InteractorToken): boolean {
    return this.resourceTokens!.includes(resource);
  }

  getCustomResourceInteractors(resource: InteractorToken) {
    if (!resource.summary) return;

    this.cys()?.forEach((cy) => {
      this.interactors.fetchCustomInteractors(resource, cy).subscribe((result) => {
        this.interactors.addInteractorOccurrenceNode(
          result.interactors,
          cy,
          result.interactors.resource
        );
        this.clear = false;
        this.updateCurrentResource(resource!.summary.name, ResourceType.CUSTOM);
        this.state.overlay.set(resource.summary.token);
      });
    });
  }

  deleteCustomResource(resource: InteractorToken) {
    const index = this.resourceTokens!.indexOf(resource);
    if (index !== -1) {
      this.resourceTokens!.splice(index, 1);
      this.cys()?.forEach((cy) => {
        cy.elements(`[resource = '${resource}']`).remove();
        this.state.overlay.set(null);
      });
    }
  }

  clearInteractors() {
    this.cys()?.forEach((cy) => {
      this.interactors.clearAllInteractorNodes(cy);
      this.clear = true;
      this.updateCurrentResource(null, null);
      this.state.overlay.set(null);
    });
  }

  updateCurrentResource(name: string | null, type: ResourceType | null) {
    if (name && type) {
      const resource: ResourceAndType = { name, type };
      this.interactors.currentResource.set(resource);
    } else {
      this.interactors.currentResource.set({ name: null, type: null });
    }
  }

  getPsicquicResources() {
    this.interactors.getPsicquicResources().subscribe((resources) => {
      this.psicquicResources = resources;

      // Ask them all what they hold here, without waiting for any of them. The
      // panel is usable straight away; the counts appear beside each resource as
      // its answer arrives.
      this.maybePrefetchCounts();
    });
  }
}
