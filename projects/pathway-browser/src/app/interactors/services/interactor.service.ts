import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import cytoscape, { NodeCollection, NodeSingular } from 'cytoscape';
import { catchError, map, Observable, of, switchMap } from 'rxjs';
import {
  CustomInteraction,
  Interactor,
  Interactors,
  InteractorToken,
  PsicquicResource,
  ResourceAndType,
  ResourceType,
} from '../model/interactor.model';

import InteractorsLayout from '../layout/interactors-layout';
import { DiagramService } from '../../services/diagram.service';
import { passesThreshold } from '../interactor-threshold';
import { CONTENT_SERVICE, OVERLAYS } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class InteractorService {
  private http = inject(HttpClient);
  private diagramService = inject(DiagramService);

  private readonly _PREFIX_INTERACTOR = `${CONTENT_SERVICE}/interactors/`;
  private readonly _PREFIX_DISEASE = `${OVERLAYS}/disgenet/`;

  private readonly _STATIC_URL = this._PREFIX_INTERACTOR + 'static/molecules/details';
  private readonly _PSICQUIC_RESOURCE_URL = this._PREFIX_INTERACTOR + 'psicquic/resources/';
  private readonly _PSICQUIC_URL = this._PREFIX_INTERACTOR + 'psicquic/molecules/';
  public readonly UPLOAD_URL = this._PREFIX_INTERACTOR + 'upload/tuple/';
  public readonly UPLOAD_PSICQUIC_URL = this._PREFIX_INTERACTOR + 'upload/psicquic/url';
  private readonly _TOKEN_URL = this._PREFIX_INTERACTOR + 'token/';

  private readonly DISGENET_URL = this._PREFIX_DISEASE + 'findByGenes';

  private readonly DEFAULT_INTERACTOR_WIDTH = 100;
  private readonly DEFAULT_DISGENET_WIDTH = 250;
  private readonly INTERACTOR_PADDING = 20;
  private readonly CHAR_WIDTH = 10;
  private readonly CHAR_HEIGHT = 12;
  private readonly GENE_DECORATION_HEIGHT = 20;

  identifiers: string = '';
  cyToSelectedResource = new Map<cytoscape.Core, string>();

  currentResource = signal<ResourceAndType>({ type: null, name: null });

  /**
   * Whether any interactors are currently drawn.
   *
   * Not the same question as "is a resource selected": choosing a resource only
   * adds the count badges, and the interactors themselves appear when one of
   * those is opened. The confidence control belongs to the second thing, because
   * until then there is nothing for it to filter.
   */
  readonly showingInteractors = signal(false);

  /**
   * How many interactors are drawn, and how many the resource offered.
   *
   * Kept so the control can tell the reader that *the threshold* is hiding them,
   * which is a different thing from the entity having none -- and the two look
   * identical on a diagram (FR-012).
   */
  /**
   * The scores of the interactions the reader has opened, so the control can show
   * where they actually lie.
   *
   * A slider from 0 to 1 is a guess without them: an entity whose interactions
   * all sit between 0.48 and 0.98 has nothing below half the track, and dragging
   * through that range does nothing at all.
   */
  readonly openedScores = signal<number[]>([]);

  /**
   * The interactions currently drawn, for the export.
   *
   * Read off the graph rather than rebuilt from the response, so the file and the
   * diagram cannot disagree: whatever the threshold is hiding is absent from
   * both.
   */
  readonly exportableInteractions = signal<
    { acc?: string; alias?: string; score?: number; evidences?: number; entity?: string }[]
  >([]);

  readonly interactorCounts = signal<{ shown: number; drawn: number; offered: number }>({
    shown: 0,
    drawn: 0,
    offered: 0,
  });
  private getIdentifiers(cy: cytoscape.Core): void {
    this.identifiers = this.getIdentifiersFromGraph(cy);
  }

  private updateIdentifiers(cy: cytoscape.Core): void {
    const currentIdentifiers = this.getIdentifiersFromGraph(cy);

    if (!this.identifiers || !this.areSame(this.identifiers, currentIdentifiers)) {
      this.identifiers = currentIdentifiers;
    } else {
      this.getIdentifiers(cy);
    }
  }

  areSame(idsA: string, idsB: string): boolean {
    const normalize = (str: string): string => str.split(',').sort().join(',');
    return normalize(idsA) === normalize(idsB);
  }

  public getIdentifiersFromGraph(cy: cytoscape.Core) {
    const graphNodes = cy?.nodes(`[graph]`);
    const result: string[] = [];

    graphNodes?.forEach((entity) => {
      const schemaClass = entity.data('graph').schemaClass;
      if (schemaClass === 'EntityWithAccessionedSequence' || schemaClass === 'SimpleEntity') {
        result.push(entity.data('acc'));
      }
    });

    // Concatenate elements from the set values into a single string
    return [...new Set(result)].join(',');
  }

  public fetchInteractorData(cy: cytoscape.Core, resource: string): Observable<Interactors> {
    this.updateIdentifiers(cy);
    let url;
    if (resource === ResourceType.STATIC) {
      url = this._STATIC_URL;
    } else if (resource === ResourceType.DISGENET) {
      url = this.DISGENET_URL;
    } else {
      url = this._PSICQUIC_URL + resource.toLowerCase() + '/details';
    }

    return this.http.post<Interactors>(url, this.identifiers, {
      headers: new HttpHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  public getCustomInteractorsByAcc(acc: string) {
    const url = `${CONTENT_SERVICE}/interactors/static/molecule/enhanced/${acc}/details`;
    return this.http.get<CustomInteraction[]>(url);
  }

  public addInteractorOccurrenceNode(
    interactors: Interactors,
    cy: cytoscape.Core,
    resource: string
  ) {
    if (this.cyToSelectedResource.has(cy) && this.cyToSelectedResource.get(cy) !== resource) {
      const previousResource = this.cyToSelectedResource.get(cy);
      cy.elements(`[resource='${previousResource}']`).remove();
      this.createInteractorOccurrenceNode(interactors, cy, resource);
      this.cyToSelectedResource.set(cy, resource);
    } else if (!this.cyToSelectedResource.has(cy)) {
      this.createInteractorOccurrenceNode(interactors, cy, resource);
      this.cyToSelectedResource.set(cy, resource);
    }

    // The badges are new elements, and whether a badge is drawn at all depends
    // on the zoom -- below 0.6 it is too small to read, so the style library
    // does not draw it. That decision lives in the zoom handler, which has no
    // reason to run just because elements were added, so it is asked to.
    //
    // Without this the badges arrive drawn whatever the zoom, and only correct
    // themselves the first time the reader touches the zoom. Caught on beta,
    // not in the test, which moved the zoom itself and so never saw the state
    // they are actually created in.
    cy.emit('zoom');
  }

  public createInteractorOccurrenceNode(
    interactors: Interactors,
    cy: cytoscape.Core,
    resource: string
  ) {
    const classes =
      resource === ResourceType.DISGENET
        ? ['InteractorOccurrences', 'disease']
        : ['InteractorOccurrences'];

    if (interactors.entities === undefined) return;

    interactors.entities
      .filter((interactorEntity) => interactorEntity.count > 0)
      .forEach((interactorEntity) => {
        const entities = cy?.nodes(`[acc = '${interactorEntity.acc}']`);
        entities?.forEach((entityNode) => {
          const pos = { ...entityNode.position() };
          pos.x += entityNode.width() / 2;
          pos.y -= entityNode.height() / 2;

          const id = entityNode.id() + '-occ' + '-' + resource.toLowerCase();

          if (!entityNode.classes().includes('Modification')) {
            const occurrenceNode = cy?.add({
              data: {
                ...entityNode.data(),
                exp: undefined,
                id: id,
                displayName: interactorEntity.count,
                entity: entityNode,
                interactors: interactorEntity.interactors,
                resource: resource,
              },
              classes: classes,
              pannable: true,
              grabbable: false,
              position: pos,
            });

            entityNode.data('occurrence', occurrenceNode);
          }
        });
      });
  }

  /**
   * Draw only the interactions at or above the confidence threshold.
   *
   * Hidden rather than removed. Removing would mean re-running the layout on
   * every drag of the control, and the reader is dragging it to look at the
   * diagram -- so the elements stay and their display changes, which cytoscape
   * does as a restyle.
   *
   * Only the dynamically added interactors are touched. An interaction whose
   * partner is already a PhysicalEntity on the diagram does not get an
   * `.Interactor` node, and hiding the real entity because one interaction scored
   * poorly would remove part of the pathway. Its edge is hidden instead, which is
   * the part that belongs to the interaction.
   */
  public applyInteractorThreshold(cy: cytoscape.Core, threshold: number): void {
    const show = (element: cytoscape.NodeSingular | cytoscape.EdgeSingular): void => {
      const score = element.data('score') as number | undefined;
      element.style('display', passesThreshold({ score }, threshold) ? 'element' : 'none');
    };

    cy.batch(() => {
      cy.nodes('.Interactor').forEach(show);
      // `edgeToTarget` is carried only by interactor edges, so it is what
      // separates them from the pathway's own.
      cy.edges('[edgeToTarget]').forEach(show);
    });

    // Three different numbers, and the reader is entitled to know when they
    // disagree: what the resource offered (the number on the badge), how many
    // the diagram has room to draw, and how many the threshold leaves visible.
    const drawn = cy.nodes('.Interactor');
    // Only the badges the reader has actually opened. Summing every badge on
    // the diagram answered "18 of 193", comparing what one entity is showing
    // against what the whole pathway offers -- a true number and a useless one.
    const offered = cy
      .nodes('.InteractorOccurrences.opened')
      .reduce(
        (total, badge) =>
          total + ((badge.data('interactors') as unknown[] | undefined)?.length ?? 0),
        0
      );
    this.interactorCounts.set({
      shown: drawn.filter((node) => node.visible()).length,
      drawn: drawn.length,
      offered,
    });

    // Everything the opened entity has -- read from the badge's own list, not
    // from what ended up drawn.
    //
    // Two reasons, both found by testing. The threshold is a view control: a
    // spreadsheet can filter further, nothing can recover rows that were never
    // written, and a file of twelve rows beside a badge reading 73 is a
    // contradiction the reader has to resolve. And reading the drawn nodes
    // quietly lost one of BHLHE40's 73 -- an interaction whose partner is already
    // a PhysicalEntity on the diagram gets an edge but no `.Interactor` node of
    // its own. The badge counts it; so should the file.
    //
    // It also means the cap cannot truncate the file: draw 100 of 150 and the
    // file still carries 150.
    this.exportableInteractions.set(
      cy
        .nodes('.InteractorOccurrences.opened')
        .reduce<
          { acc?: string; alias?: string; score?: number; evidences?: number; entity?: string }[]
        >((rows, badge) => {
          const entity = badge.data('entity')?.data('displayName') as string | undefined;
          const interactions = (badge.data('interactors') ?? []) as {
            acc?: string;
            alias?: string;
            score?: number;
            evidences?: number;
          }[];
          return rows.concat(
            interactions.map((interaction) => ({
              acc: interaction.acc,
              alias: interaction.alias,
              score: interaction.score,
              evidences: interaction.evidences,
              entity,
            }))
          );
        }, [])
    );

    this.openedScores.set(
      cy
        .nodes('.InteractorOccurrences.opened')
        .reduce<number[]>((scores, badge) => {
          const interactions = (badge.data('interactors') ?? []) as { score?: number }[];
          return scores.concat(
            interactions
              .map((interaction) => interaction.score)
              .filter((score): score is number => typeof score === 'number')
          );
        }, [])
        .sort((a, b) => a - b)
    );
  }

  public addInteractorNodes(occurrenceNode: cytoscape.NodeSingular, cy: cytoscape.Core) {
    // One entity's interactors at a time.
    //
    // They used to accumulate, which the old browser also allows -- but the
    // confidence control below the diagram describes *the* shown set, and with
    // two entities open "18 of 46" is answering a question nobody asked. Either
    // the control had to become per-entity or the diagram had to show one
    // entity's partners at a time; the second is simpler to read and simpler to
    // explain.
    cy.nodes('.InteractorOccurrences.opened').forEach((other) => {
      if (other.id() === occurrenceNode.id()) return;
      this.removeInteractorNodes(other);
      other.removeClass('opened');
    });

    const interactorsData = occurrenceNode.data('interactors');
    const resource = occurrenceNode.data('resource');
    InteractorsLayout.BOX_WIDTH =
      resource === ResourceType.DISGENET
        ? this.DEFAULT_DISGENET_WIDTH / 2
        : this.DEFAULT_INTERACTOR_WIDTH / 2;
    const numberToAdd = InteractorsLayout.getNumberOfInteractorsToDraw(interactorsData);
    const [dynamicInteractors, existingInteractors] = this.getAllInteractors(
      interactorsData,
      cy,
      numberToAdd
    );
    const allNodes: Interactor[] = [...dynamicInteractors, ...existingInteractors];
    cy.batch(() => {
      const nodes = this.createInteractorNodes(
        dynamicInteractors,
        occurrenceNode,
        cy,
        dynamicInteractors.length,
        resource
      );
      this.createInteractorEdges(allNodes, occurrenceNode, cy, resource);

      this.displayInteractors(nodes, cy);
    });
    this.showingInteractors.set(cy.nodes('.Interactor').length > 0);
  }

  public getAllInteractors(interactorsData: Interactor[], cy: cytoscape.Core, numberToAdd: number) {
    const dynamicInteractors = [];
    const existingInteractors = [];
    // Best supported first, so that the cap keeps the interactions worth keeping.
    //
    // Only 18 of an entity's interactors are drawn (MAX_INTERACTORS), and KLF15
    // on R-HSA-1368108 has 46 -- so 28 are dropped, and until now which 28 was
    // whatever order the service happened to return. The old browser has always
    // sorted by score and then by accession (InteractorsContent.getRawInteractors),
    // which is what makes a cap defensible: the ones you lose are the ones with
    // the least evidence behind them.
    interactorsData = [...interactorsData].sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.acc ?? '').localeCompare(b.acc ?? '')
    );
    // get interactors to draw with a provided a number, collect existing interactors for creating edge
    for (const interactor of interactorsData) {
      const diagramNodes = cy?.nodes(`.PhysicalEntity[acc = '${interactor.acc}']`);

      if (!diagramNodes || diagramNodes.length === 0) {
        dynamicInteractors.push(interactor);
      } else {
        interactor.existingNodes = diagramNodes;
        existingInteractors.push(interactor);
      }
    }

    // Chosen by score, but *placed* alphabetically. Position round the entity is
    // how a reader looks for a particular gene, and score order makes that a
    // hunt; the selection is already made by the time we get here, so ordering it
    // by name costs nothing and the two decisions stop fighting each other.
    const drawn = dynamicInteractors
      .slice(0, numberToAdd)
      .sort((a, b) => (a.alias ?? a.acc ?? '').localeCompare(b.alias ?? b.acc ?? ''));
    return [drawn, existingInteractors];
  }

  public createInteractorNodes(
    interactorsData: Interactor[],
    targetNode: NodeSingular,
    cy: cytoscape.Core,
    numberToAdd: number,
    resource: string
  ) {
    const interactorNodes: cytoscape.NodeDefinition[] = [];
    const interactorLayout = new InteractorsLayout();

    interactorsData.forEach((interactor: Interactor, index: number) => {
      const position = interactorLayout.getPosition(targetNode, index, numberToAdd);
      const displayName = interactor.alias ? interactor.alias : interactor.acc;
      const defaultType = ['Protein', 'PhysicalEntity']; // Default interactor type for custom resource when there is no type data provided
      const classes =
        resource === ResourceType.DISGENET
          ? ['PhysicalEntity', 'Interactor', 'disease']
          : [
              ...(this.diagramService.nodeTypeMap.get(interactor.type) || defaultType),
              'Interactor',
            ];
      const width =
        resource === ResourceType.DISGENET
          ? this.DEFAULT_DISGENET_WIDTH
          : this.DEFAULT_INTERACTOR_WIDTH;
      let height = this.CHAR_HEIGHT + 2 * this.INTERACTOR_PADDING;
      if (interactor.type === 'Gene') height += this.GENE_DECORATION_HEIGHT;

      const id = 'interactor-' + interactor.acc;
      interactorNodes.push({
        data: {
          ...targetNode.data(),
          id: id,
          graph: {
            ...targetNode.data('graph'),
            leaves: undefined,
            identifier: interactor.acc,
          },
          exp: undefined,
          displayName: displayName.replace(/([/,:;-])/g, '$1\u200b'),
          html: this.diagramService.getStructureVideoHtml(
            {
              id,
              type: interactor.type || 'Protein',
            },
            width,
            height,
            interactor.acc
          ),
          width: width,
          height: height,
          accURL: interactor.accURL,
          score: interactor.score,
          evidences: interactor.evidences,
          evidenceURLs: interactor.evidencesURL,
          resource: resource,
        },
        classes: classes,
        position: position,
        selectable: false,
      });
    });
    return cy?.add(interactorNodes);
  }

  public createInteractorEdges(
    interactorsData: Interactor[],
    occurrenceNode: NodeSingular,
    cy: cytoscape.Core | undefined,
    resource: string
  ) {
    if (!cy) return;

    const resourceClass =
      resource === ResourceType.DISGENET ? ['Interactor', 'disease'] : ['Interactor'];

    const interactorEdges: cytoscape.EdgeDefinition[] = [];
    interactorsData.forEach((interactor: Interactor) => {
      const entity = occurrenceNode.data('entity');
      const targetNodes = interactor.existingNodes
        ? interactor.existingNodes
        : [cy.getElementById('interactor-' + interactor.acc)];
      targetNodes.forEach((targetNode) => {
        interactorEdges.push({
          data: {
            ...targetNode.data(),
            id: interactor.acc + '-' + entity.id(),
            source: entity.id(),
            target: targetNode.id(),
            edgeToTarget: occurrenceNode.id(),
            evidenceURLs: interactor.evidencesURL,
            // Explicitly, not from the spread above: for an interactor that is
            // already a PhysicalEntity on the diagram the target is that entity,
            // which has no score of its own. Without this the edge could not be
            // filtered alongside the node it belongs to.
            score: interactor.score,
            resource: resource,
          },
          classes: resourceClass,
          selectable: false,
        });
      });
    });
    cy?.add(interactorEdges);
  }

  public displayInteractors(interactorsToDisplay: NodeCollection, cy: cytoscape.Core) {
    const layoutOptions: cytoscape.LayoutOptions = {
      name: 'preset',
      fit: false,
    };
    interactorsToDisplay.layout(layoutOptions).run();
  }

  public removeInteractorNodes(occurrenceNode: cytoscape.NodeSingular) {
    const entityNode = occurrenceNode.data('entity');
    const interactors = entityNode.closedNeighborhood('node.Interactor');
    const cy = occurrenceNode.cy();

    entityNode.connectedEdges('.Interactor').remove();
    interactors.forEach((interactor: cytoscape.NodeSingular) => {
      if (interactor.connectedEdges().empty()) {
        interactor.remove();
      }
    });

    // The confidence control follows this, so it has to be true after a close as
    // well as after an open. It was only ever set when interactors were added,
    // which left the control on screen describing a diagram with nothing on it.
    this.showingInteractors.set(cy.nodes('.Interactor').length > 0);
    if (!this.showingInteractors()) {
      this.interactorCounts.set({ shown: 0, drawn: 0, offered: 0 });
      this.openedScores.set([]);
      this.exportableInteractions.set([]);
    }
  }

  /**
   * Put every open entity's interactors away.
   *
   * What the control's dismiss does, and what closing the last one does anyway.
   * The overlay itself stays: the reader chose a resource, and taking that away
   * too would be answering a question they did not ask.
   */
  public closeAllInteractors(cy?: cytoscape.Core) {
    // Every diagram that has a resource on it, when none is named. The compare
    // view has its own graph, and a control that dismissed only one of them would
    // leave the other showing interactors with nothing to filter them by.
    const graphs = cy ? [cy] : [...this.cyToSelectedResource.keys()];
    for (const graph of graphs) {
      graph.nodes('.InteractorOccurrences.opened').forEach((badge) => {
        this.removeInteractorNodes(badge);
        badge.removeClass('opened');
      });
    }
  }

  public clearAllInteractorNodes(cy: cytoscape.Core) {
    this.cyToSelectedResource.clear();
    this.showingInteractors.set(false);
    const interactorOcc = cy.elements(`.InteractorOccurrences`).remove();
    interactorOcc.forEach((node) => {
      if (node.hasClass('opened')) {
        this.removeInteractorNodes(node);
      }
    });
  }

  public getPsicquicResources(): Observable<PsicquicResource[]> {
    return this.http
      .get<PsicquicResource[]>(this._PSICQUIC_RESOURCE_URL, {
        headers: new HttpHeaders({ 'Content-Type': 'application/json;charset=UTF-8' }),
      })
      .pipe(
        map((psicquicResources) => {
          return psicquicResources.filter((r) => r.name !== ResourceType.STATIC && r.active);
        })
      );
  }

  public getInteractorsToken(name: string, url: string, body: string | FormData) {
    return this.http.post<InteractorToken>(url, body, {
      params: new HttpParams().set('name', name),
    });
  }

  /**
   * This method is used in custom dialog for retrieving interactors with a token , it first generates a token then
   * get interactors data from that token. There are different API calls based on user's selection to generate tokens.
   *
   * @param name custom resource name
   * @param url  different URLs, for instance, add data from a local file, the url will be UPLOAD_URL
   * @param body content
   * @param cy   cytoscape container
   */
  public getInteractorsFromToken(
    name: string,
    url: string,
    body: string | FormData,
    cy: cytoscape.Core
  ): Observable<{
    token: InteractorToken;
    interactors: Interactors;
  }> {
    this.updateIdentifiers(cy);
    return this.getInteractorsToken(name, url, body).pipe(
      switchMap((token) => this.fetchCustomInteractors(token, cy))
    );
  }

  public fetchCustomInteractors(
    token: InteractorToken,
    cy: cytoscape.Core
  ): Observable<{
    token: InteractorToken;
    interactors: Interactors;
  }> {
    this.updateIdentifiers(cy);
    return this.http
      .post<Interactors>(this._TOKEN_URL + token.summary.token, this.identifiers, {
        headers: new HttpHeaders({ 'Content-Type': 'text/plain' }),
      })
      .pipe(map((interactors) => ({ token: token, interactors: interactors })));
  }

  public getResourceTypeStatic(resource: string): ResourceType | null {
    if (resource === ResourceType.STATIC) {
      return ResourceType.STATIC;
    }
    if (resource === ResourceType.DISGENET) {
      return ResourceType.DISGENET;
    }

    // isFromPSICQUIC will be a function with a static dictionary to map to result, not Observable
    if (this.isFromPSICQUIC(resource)) {
      return ResourceType.PSICQUIC;
    }
    // none of above then is custom
    if (this.isCustomResource(resource)) {
      return ResourceType.CUSTOM;
    }

    return null;
  }

  public getResourceType(resource: string): Observable<ResourceType | null> {
    if (resource === ResourceType.STATIC) {
      return of(ResourceType.STATIC);
    }
    if (resource === ResourceType.DISGENET) {
      return of(ResourceType.DISGENET);
    }

    return this.isFromPSICQUIC(resource).pipe(
      switchMap((isPsicquic) => {
        if (isPsicquic) {
          return of(ResourceType.PSICQUIC);
        }

        return this.isCustomResource(resource).pipe(
          map((isCustom) => (isCustom ? ResourceType.CUSTOM : null))
        );
      }),
      catchError(() => of(null))
    );
  }

  public isFromPSICQUIC(resource: string): Observable<boolean> {
    if (!resource) {
      return of(false);
    }

    return this.getPsicquicResources().pipe(
      map((psicquicResources) =>
        psicquicResources.some((pr) => pr.name === resource && pr.name !== ResourceType.STATIC)
      )
    );
  }

  public isCustomResource(resource: string): Observable<boolean> {
    if (!resource) {
      return of(false);
    }

    return this.getPsicquicResources().pipe(
      map((psicquicResources) => {
        const isPsicquic = psicquicResources.some(
          (pr) => pr.name === resource && pr.name !== ResourceType.STATIC
        );
        return (
          resource !== ResourceType.STATIC && resource !== ResourceType.DISGENET && !isPsicquic
        );
      })
    );
  }
}
