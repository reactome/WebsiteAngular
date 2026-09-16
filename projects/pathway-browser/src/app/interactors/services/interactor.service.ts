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
import { clampThreshold, DEFAULT_INTERACTOR_SCORE, passesThreshold } from '../interactor-threshold';
import { INTERACTOR_BADGE_MIN_ZOOM } from 'reactome-cytoscape-style';
import { UrlStateService } from '../../services/url-state.service';

/**
 * What the drawn badges add up to, counted once per protein.
 *
 * Badges are not the unit: a protein drawn twice in a diagram gets two, each
 * repeating the same interactions. On R-HSA-69306 with Reactome-FIs that is 15
 * badges over 13 accessions, so adding the badges up gives 84 where the resource
 * holds 78 -- and the panel, which asks the resource directly before anything is
 * drawn, would show 78 and then change its mind to 84 on the click.
 * Measured 2026-09-14.
 */
function tallyBadges(badges: cytoscape.NodeCollection): ResourceTally {
  const byAccession = new Map<string, number>();
  badges.forEach((badge) => {
    const accession = (badge.data('acc') as string | undefined) ?? badge.id();
    const interactions = (badge.data('interactors') as unknown[] | undefined)?.length ?? 0;
    byAccession.set(accession, Math.max(byAccession.get(accession) ?? 0, interactions));
  });
  return {
    interactions: [...byAccession.values()].reduce((total, count) => total + count, 0),
    entities: byAccession.size,
  };
}

/** What a resource holds for one diagram, in both units the UI shows. */
export interface ResourceTally {
  /** Interactions, the unit an entity's badge uses. */
  interactions: number;
  /** How many entities have any, which is the coverage of the diagram. */
  entities: number;
}
import { CONTENT_SERVICE, OVERLAYS } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class InteractorService {
  private http = inject(HttpClient);
  private diagramService = inject(DiagramService);
  private urlState = inject(UrlStateService);

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
   * A resource was chosen and had nothing for this diagram.
   *
   * Distinct from "nothing opened yet": BioGrid answers 200 with no interactions
   * for R-HSA-1368108, so every button looked the same as IntAct and the diagram
   * did not change. The old browser says so at the foot of the diagram --
   * `MSG_NO_INTERACTORS_FOUND` in InteractorsControl -- and so should this.
   */
  readonly resourceFoundNothing = signal(false);

  /**
   * What each resource turned out to hold for the diagram in front of us.
   *
   * Thirteen live PSICQUIC resources are offered and they look identical, so
   * finding one with anything to say means clicking them in turn -- and clicking
   * the same empty ones again on the next visit. The resource list itself cannot
   * help: it carries name, restURL and active, and no counts, so knowing a count
   * in advance would mean one request per resource to a third-party server.
   *
   * This is the affordable half: whatever a resource turns out to hold is
   * remembered and shown beside it. It does not spare the first click, and it
   * spares every one after that.
   *
   * Keyed by pathway, because the answer is a property of the diagram.
   */
  readonly resourceCounts = signal<Record<string, ResourceTally>>({});
  private countsForPathway: string | null = null;

  /**
   * Ask every live resource what it holds for this diagram, in the background.
   *
   * Measured on R-HSA-1368108: the thirteen live resources take 6s to 17s each
   * and 17s for all of them in parallel, because they are third-party PSICQUIC
   * servers. Far too slow to make the reader wait for -- so nothing waits. The
   * panel is usable immediately and the counts arrive as they land, which is
   * before all but the first click.
   *
   * Five of those thirteen had nothing at all for that pathway, which is the
   * whole reason this is worth doing: without it the only way to find that out
   * is to click each one and wait.
   *
   * Only resources we have not already asked about, so re-opening the panel
   * costs nothing. `resourceCounts` is cleared when the pathway changes.
   */
  private prefetching = new Set<string>();

  public prefetchResourceCounts(cy: cytoscape.Core, resources: string[]): void {
    const pathway = this.urlState.pathwayId() ?? null;
    for (const resource of resources) {
      // Answered, or already being asked. Without the second test this ran
      // twice -- the resource list and the graph each start it, and neither
      // had an answer yet when the other began -- turning thirteen requests
      // to third-party servers into twenty-six.
      if (this.resourceCounts()[resource] !== undefined) continue;
      if (this.prefetching.has(resource)) continue;
      this.prefetching.add(resource);
      this.fetchInteractorData(cy, resource)
        .pipe(
          map((interactors) => {
            const covered = (interactors.entities ?? []).filter(
              (entity) => (entity.interactors ?? []).length > 0
            );
            return {
              // The badge on an entity counts interactions, so this must too --
              // otherwise the panel says "15" for Reactome-FIs while MCM7's badge
              // says 17, and the reader is right to call that impossible. It was
              // counting entities.
              interactions: covered.reduce(
                (total, entity) => total + (entity.interactors ?? []).length,
                0
              ),
              entities: covered.length,
            };
          }),
          catchError(() => of(null))
        )
        .subscribe((withInteractors) => {
          this.prefetching.delete(resource);
          // A resource that failed is left unanswered rather than reported as
          // empty: "we could not ask" and "it has none" are different, and only
          // one of them should stop the reader trying.
          if (withInteractors) this.rememberResourceCount(pathway, resource, withInteractors);
        });
    }
  }

  /**
   * The threshold each resource was last left at.
   *
   * Resources do not score alike, so one number across all of them is the wrong
   * shape: measured 2026-09-14 on R-HSA-69306, Reactome-FIs returns scores a
   * curator reads differently from IntAct's, and a threshold that is a useful
   * floor for one buries the other. The old browser holds one per resource --
   * `Map<String, Double> interactorsThreshold` in pwp-diagram's
   * `InteractorsContent.java` -- and a curator comparing the two sites should
   * not have to reset the control every time they switch (FR-004a).
   *
   * Deliberately not in the URL. The URL carries the threshold in force, which is
   * what a shared address needs; remembering the other resources' is a
   * convenience for the reader who is switching, and putting all thirteen in the
   * address would make it unreadable for no one's benefit.
   */
  private thresholdByResource = new Map<string, number>();

  /** Note where the reader left this resource, so returning to it comes back here. */
  public rememberThreshold(resource: string | null | undefined, threshold: number): void {
    if (resource) this.thresholdByResource.set(resource, threshold);
  }

  /**
   * Whether a threshold in the address is still waiting to be claimed.
   *
   * The overlay in a shared address is replayed through the same call a reader's
   * click goes through -- `stateToDiagram` reads `state.overlay()` and calls
   * `getInteractors` with it -- so the first activation after a load is not a
   * switch, it is the address being honoured. Without this distinction the
   * restore below overwrote the threshold the address asked for: measured on
   * beta, `?overlay=Reactome-FIs&interactorScore=0.8` arrived and settled at no
   * threshold at all, while the same address without the overlay kept 0.8.
   */
  private addressThresholdUnclaimed = true;

  /**
   * Put the threshold this resource was last left at back into force.
   *
   * A resource never seen before opens at the default rather than inheriting
   * whatever the previous one was set to -- inheriting is how a reader ends up
   * with an empty diagram and no idea why.
   *
   * Except the first time, when what is in force came from the address rather
   * than from a previous resource, so it belongs to this resource and is kept.
   */
  public restoreThreshold(resource: string | null | undefined): void {
    if (this.addressThresholdUnclaimed) {
      this.addressThresholdUnclaimed = false;
      this.rememberThreshold(resource, clampThreshold(this.urlState.interactorScore()));
      return;
    }

    const remembered = resource ? this.thresholdByResource.get(resource) : undefined;
    this.urlState.interactorScore.set(remembered ?? DEFAULT_INTERACTOR_SCORE);
  }

  /** Forget them all, because they described a diagram we have left. */
  public forgetThresholds(): void {
    this.thresholdByResource.clear();
  }

  /**
   * Badges are on the diagram, but the reader cannot see any of them.
   *
   * They are not drawn below 0.6 zoom, where two digits are a smudge. That is
   * right, and it left a hole: choosing a resource at the zoom a pathway opens at
   * changed nothing on screen and said nothing either. Measured on
   * R-HSA-1368108, which opens at 0.283: nine badges on the graph, none visible,
   * no message anywhere. The overlay looked broken, which is the complaint this
   * whole feature started from.
   */
  readonly badgesHiddenByZoom = signal(false);

  /** One zoom listener per graph, however many times a resource is chosen. */
  private watchingBadgeVisibility = new WeakSet<cytoscape.Core>();

  /** Set when the reader put the bar away, cleared when they choose a resource. */
  private badgeHintDismissed = false;

  /** Keep `badgesHiddenByZoom` true only while there is something to reveal. */
  private watchBadgeVisibility(cy: cytoscape.Core): void {
    const update = () => {
      const badges = cy.nodes('.InteractorOccurrences');
      this.badgesHiddenByZoom.set(
        !this.badgeHintDismissed &&
          badges.length > 0 &&
          badges.filter((badge) => badge.visible()).length === 0
      );
    };
    if (!this.watchingBadgeVisibility.has(cy)) {
      this.watchingBadgeVisibility.add(cy);
      cy.on('zoom', update);
    }
    // Only a graph that actually carries them: this is called for every graph,
    // and the comparison view has a second one with none, which was overwriting
    // the real answer.
    if (cy.nodes('.InteractorOccurrences').length > 0) this.badgeGraph = cy;
    // A new choice is a new question, so a previous dismissal does not silence
    // the answer to it.
    this.badgeHintDismissed = false;
    update();
  }

  /** The graph the badges were last drawn on. */
  private badgeGraph: cytoscape.Core | null = null;

  /**
   * The graph a resource is currently drawn on.
   *
   * The one the badges were drawn on, which is the one this is asked about.
   * `cyToSelectedResource` was the obvious source and was the wrong one -- it
   * came back empty here, so the reveal button did nothing at all while the same
   * fit run by hand in the page moved the zoom from 0.283 to 0.65.
   *
   * Falls back to the first selected graph: when the comparison view has two,
   * the reader is looking at one of them, and zooming the other would answer a
   * question nobody asked.
   */
  public currentGraph(): cytoscape.Core | null {
    return this.badgeGraph ?? [...this.cyToSelectedResource.keys()][0] ?? null;
  }

  /**
   * Bring the badges up to a size their digits can be read at.
   *
   * Centred on the badges rather than on the whole diagram, because the reason
   * the reader cannot see them is that the diagram is what is being fitted.
   */
  public revealBadges(cy: cytoscape.Core): void {
    const badges = cy.nodes('.InteractorOccurrences');
    if (badges.length === 0) return;

    // The entities, not the badges. `fit` ignores elements it cannot see, and
    // the badges are hidden -- which is the whole reason this button exists --
    // so fitting to them moved nothing at all: nine badges, zoom 0.283 before
    // and 0.283 after. Their entities are on the diagram and visible.
    const entities = badges.reduce((collection, badge) => {
      const entity = badge.data('entity') as NodeSingular | undefined;
      return entity ? collection.union(entity) : collection;
    }, cy.collection() as cytoscape.Collection);
    if (entities.length > 0) cy.fit(entities, 80);

    // Fitting a scattered handful can still land below the zoom the badge is
    // drawn at -- measured 0.308 for these nine -- which would leave the reader
    // exactly where they started. A little past it, so the digits are legible
    // rather than borderline.
    if (cy.zoom() < INTERACTOR_BADGE_MIN_ZOOM) {
      cy.zoom({
        level: INTERACTOR_BADGE_MIN_ZOOM + 0.05,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
    }
  }

  /**
   * Resources parsed in the page rather than uploaded.
   *
   * Held for the life of the page, which is as long as they can be drawn: there
   * is no token, because there is nothing on a server to point at. Choosing one
   * again redraws from here instead of asking for a token that does not exist.
   */
  private localResources = new Map<string, Interactors>();

  public rememberLocalResource(name: string, interactors: Interactors): void {
    this.localResources.set(name, interactors);
  }

  public localResource(name: string | null | undefined): Interactors | undefined {
    return name ? this.localResources.get(name) : undefined;
  }

  /** Drop one the reader deleted, so its name is free and its data is gone. */
  public forgetLocalResource(name: string): void {
    this.localResources.delete(name);
  }

  /** Note what a resource held here, forgetting the tally if the pathway changed. */
  private rememberResourceCount(pathway: string | null, resource: string, count: ResourceTally) {
    if (pathway !== this.countsForPathway) {
      this.countsForPathway = pathway;
      this.resourceCounts.set({});
    }
    this.resourceCounts.update((counts) => ({ ...counts, [resource]: count }));
  }

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

    // Nothing drawn and nothing to draw: the resource has no interactions here.
    const badges = cy.nodes('.InteractorOccurrences');
    this.resourceFoundNothing.set(badges.length === 0);
    this.rememberResourceCount(this.urlState.pathwayId() ?? null, resource, tallyBadges(badges));
    this.watchBadgeVisibility(cy);
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

    // Dismissing the bar means dismissing the bar. The badges are still there
    // and still too small to draw, so without this the "there are interactors
    // here" state simply put it straight back -- the close button looked broken
    // at exactly the zoom a pathway opens at. Caught by CI, which opens smaller
    // than the browser this was checked in.
    this.badgeHintDismissed = true;
    this.badgesHiddenByZoom.set(false);
  }

  public clearAllInteractorNodes(cy: cytoscape.Core) {
    this.cyToSelectedResource.clear();
    this.showingInteractors.set(false);
    this.resourceFoundNothing.set(false);
    this.badgesHiddenByZoom.set(false);
    this.badgeGraph = null;
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
