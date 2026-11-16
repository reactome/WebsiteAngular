/**
 * Drawing an entity's interactors from what its badge keeps.
 *
 * Cytoscape hands back whatever was stored on an element, so the badge's list,
 * its entity and its resource are read through guards: what was stored there is
 * drawn as before, and anything else is drawn as nothing rather than throwing.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';

import { InteractorService } from './interactor.service';
import { DiagramService } from '../../services/diagram.service';
import { UrlStateService } from '../../services/url-state.service';

describe("drawing an entity's interactors", () => {
  let service: InteractorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InteractorService,
        { provide: HttpClient, useValue: {} },
        {
          provide: DiagramService,
          useValue: { nodeTypeMap: new Map<string, string[]>(), getStructureVideoHtml: () => '' },
        },
        { provide: UrlStateService, useValue: { pathwayId: signal(undefined) } },
      ],
    });
    service = TestBed.inject(InteractorService);
  });

  const diagram = () =>
    cytoscape({
      headless: true,
      elements: [
        {
          data: {
            id: '1',
            acc: 'P1',
            displayName: 'KLF15',
            graph: { schemaClass: 'EntityWithAccessionedSequence', stId: 'R-HSA-1' },
          },
          classes: ['Protein', 'PhysicalEntity'],
          position: { x: 100, y: 100 },
        },
        {
          data: { id: '2', acc: 'CHEBI:1', graph: { schemaClass: 'SimpleEntity' } },
          classes: ['PhysicalEntity'],
        },
        { data: { id: '3', acc: 'R-HSA-3', graph: { schemaClass: 'Complex' } } },
        { data: { id: '4', graph: { schemaClass: 'EntityWithAccessionedSequence' } } },
      ],
    });

  it("asks for the accessions of the diagram's proteins and chemicals, and nothing else", () => {
    // The entity with no accession added an empty identifier: "P1,CHEBI:1,".
    expect(service.getIdentifiersFromGraph(diagram())).toBe('P1,CHEBI:1');
  });

  it('draws them round the entity, joined to it, and puts them away', () => {
    const cy = diagram();
    const interactors = [
      { acc: 'Q2', alias: 'BETA', id: 2, accURL: 'u2', score: 0.9 },
      { acc: 'Q1', alias: 'ALPHA', id: 1, accURL: 'u1', score: 0.5 },
      { acc: 'CHEBI:1', id: 3, accURL: 'u3', score: 0.7 },
    ];
    service.createInteractorOccurrenceNode(
      { resource: 'IntAct', entities: [{ acc: 'P1', count: 3, interactors }] },
      cy,
      'IntAct'
    );
    const badge = cy.$id('1-occ-intact');
    expect(badge.data('entity')).toBe(cy.$id('1'));

    service.addInteractorNodes(badge, cy);

    const drawn = cy.nodes('.Interactor');
    expect(drawn.map((node) => node.id()).sort()).toEqual(['interactor-Q1', 'interactor-Q2']);
    const alpha = cy.$id('interactor-Q1');
    expect(alpha.data('displayName')).toBe('ALPHA');
    expect(alpha.data('resource')).toBe('IntAct');
    // The entity's own data, copied, with the interactor's identifier in its graph.
    expect(alpha.data('acc')).toBe('P1');
    expect(alpha.data('graph')).toEqual({
      schemaClass: 'EntityWithAccessionedSequence',
      stId: 'R-HSA-1',
      leaves: undefined,
      identifier: 'Q1',
    });
    const centre = alpha.position();
    expect(Math.hypot(centre.x - 100, centre.y - 100)).toBeGreaterThan(0);
    expect(
      cy
        .edges('[edgeToTarget]')
        .map((edge) => `${edge.source().id()}>${edge.target().id()}`)
        .sort()
    ).toEqual(['1>2', '1>interactor-Q1', '1>interactor-Q2']);
    expect(service.showingInteractors()).toBe(true);

    service.removeInteractorNodes(badge);

    expect(cy.nodes('.Interactor').length).toBe(0);
    expect(cy.edges('[edgeToTarget]').length).toBe(0);
    expect(service.showingInteractors()).toBe(false);
  });

  it('draws nothing for a badge with no list of interactors, rather than throwing', () => {
    const cy = diagram();
    cy.add({ data: { id: 'badge', entity: cy.$id('1'), interactors: null, resource: 'IntAct' } });

    service.addInteractorNodes(cy.$id('badge'), cy);

    expect(cy.nodes('.Interactor').length).toBe(0);
    expect(service.showingInteractors()).toBe(false);
  });

  it('draws nothing for a badge with no entity, and puts nothing away, rather than throwing', () => {
    const cy = diagram();
    const interactors = [{ acc: 'Q1', id: 1, accURL: 'u1' }];
    cy.add({ data: { id: 'badge', interactors, resource: 'IntAct' } });

    service.addInteractorNodes(cy.$id('badge'), cy);
    expect(cy.nodes('.Interactor').length).toBe(0);

    service.removeInteractorNodes(cy.$id('badge'));
    expect(service.showingInteractors()).toBe(false);
  });
});
