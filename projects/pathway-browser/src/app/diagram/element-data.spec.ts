import cytoscape from 'cytoscape';
import { Style } from 'ngx-reactome-cytoscape-style';
import { describe, expect, it } from 'vitest';
import {
  allData,
  drawnInteractors,
  graphLeaves,
  interactorAccessions,
  listData,
  nodeData,
  numberData,
  recordData,
  selectedStId,
  shadowEdges,
  styleOf,
  textData,
} from './element-data';

function node(data: Record<string, unknown>) {
  return cytoscape({ headless: true, elements: [{ data: { id: 'n', ...data } }] }).$id('n');
}

describe("reading a diagram element's data", () => {
  it('reads text as text, and anything else as absent', () => {
    const n = node({ graph: { stId: 'R-HSA-1' }, displayName: 'ATP', acc: 42 });
    expect(textData(n, 'graph.stId')).toBe('R-HSA-1');
    expect(textData(n, 'displayName')).toBe('ATP');
    expect(textData(n, 'acc')).toBeUndefined();
    expect(textData(n, 'missing')).toBeUndefined();
  });

  it('reads a number as a number, and anything else as absent', () => {
    const n = node({ reactomeId: 109581, text: '109581' });
    expect(numberData(n, 'reactomeId')).toBe(109581);
    expect(numberData(n, 'text')).toBeUndefined();
    expect(numberData(n, 'missing')).toBeUndefined();
  });

  it("selects the first element's stable id, or none", () => {
    const cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'a', graph: { stId: 'R-HSA-1' } } },
        { data: { id: 'b', graph: { stId: 'R-HSA-2' } } },
        { data: { id: 'c' } },
        { data: { id: 'd', graph: { stId: '' } } },
      ],
    });
    expect(selectedStId(cy.$id('a'))).toBe('R-HSA-1');
    expect(selectedStId(cy.$id('b').union(cy.$id('a')))).toBe('R-HSA-2');
    expect(selectedStId(cy.$id('c'))).toBeNull();
    expect(selectedStId(cy.collection())).toBeNull();
    // Passed on as it is, as before: the selection is then cleared.
    expect(selectedStId(cy.$id('d'))).toBe('');
  });

  it("reads an entity's leaves where it has a list of them", () => {
    const leaves = [{ stId: 'R-HSA-1' }, null, 'P1', { stId: 'R-HSA-2' }];
    expect(graphLeaves(node({ graph: { leaves } }))).toEqual([
      { stId: 'R-HSA-1' },
      { stId: 'R-HSA-2' },
    ]);
    expect(graphLeaves(node({ graph: { leaves: [] } }))).toEqual([]);
    expect(graphLeaves(node({ graph: {} }))).toBeUndefined();
    expect(graphLeaves(node({ graph: { leaves: 'R-HSA-1' } }))).toBeUndefined();
  });

  it("reads an interactor occurrence's accessions", () => {
    const interactors = [{ acc: 'P1' }, { acc: 2 }, null, { name: 'x' }, { acc: 'P3' }];
    expect(interactorAccessions(node({ interactors }))).toEqual(['P1', 'P3']);
    expect(interactorAccessions(node({}))).toEqual([]);
  });

  it('reads everything on an element, and an object under a name, to copy', () => {
    const n = node({ graph: { stId: 'R-HSA-1' }, acc: 'P1', label: 'x' });
    expect(allData(n)).toEqual({ id: 'n', graph: { stId: 'R-HSA-1' }, acc: 'P1', label: 'x' });
    expect(allData({ data: () => undefined })).toEqual({});
    expect(recordData(n, 'graph')).toEqual({ stId: 'R-HSA-1' });
    expect(recordData(n, 'acc')).toBeUndefined();
    expect(recordData(n, 'missing')).toBeUndefined();
  });

  it('reads a list where it is one', () => {
    expect(listData(node({ interactors: [1, null] }), 'interactors')).toEqual([1, null]);
    expect(listData(node({ interactors: null }), 'interactors')).toBeUndefined();
    expect(listData(node({ interactors: { length: 2 } }), 'interactors')).toBeUndefined();
  });

  it("reads an interactor occurrence's entity where it is a node", () => {
    const cy = cytoscape({ headless: true, elements: [{ data: { id: 'e' } }] });
    const entity = cy.$id('e');
    const badge = cy.add({ data: { id: 'b', entity } });
    expect(nodeData(badge, 'entity')).toBe(entity);
    badge.data('entity', 'e');
    expect(nodeData(badge, 'entity')).toBeUndefined();
    badge.data('entity', { id: 'e' });
    expect(nodeData(badge, 'entity')).toBeUndefined();
    badge.data('entity', { id: () => 'e', position: () => ({ x: 0, y: 0 }) });
    expect(nodeData(badge, 'entity')).toBeUndefined();
    badge.removeData('entity');
    expect(nodeData(badge, 'entity')).toBeUndefined();
  });

  it("reads an interactor occurrence's interactors: those with an accession", () => {
    const kept = { acc: 'P1', alias: 'A', score: 0.5 };
    const interactors = [kept, { acc: 2 }, null, 'P3', { alias: 'x' }];
    const read = drawnInteractors(node({ interactors }));
    expect(read).toEqual([kept]);
    // The same objects: drawing marks the ones already on the diagram.
    expect(read[0]).toBe(interactors[0]);
    expect(drawnInteractors(node({ interactors: null }))).toEqual([]);
    expect(drawnInteractors(node({}))).toEqual([]);
  });

  it("reads a sub-pathway's edges where they are a collection", () => {
    const cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'a' } },
        { data: { id: 'b' } },
        { data: { id: 'e', source: 'a', target: 'b', pathway: 7 } },
        { data: { id: 's', reactomeId: 7 } },
      ],
    });
    const shadow = cy.$id('s');
    expect(shadowEdges(shadow)).toBeUndefined();
    const edges = cy.edges('[pathway=7]');
    shadow.data('edges', edges);
    expect(shadowEdges(shadow)?.same(edges)).toBe(true);
    shadow.data('edges', ['e']);
    expect(shadowEdges(shadow)).toBeUndefined();
    shadow.data('edges', { style: 'dashed' });
    expect(shadowEdges(shadow)).toBeUndefined();
  });

  it('finds the style bound to a graph, and nothing else', () => {
    const cy = cytoscape({ headless: true });
    expect(styleOf(cy)).toBeUndefined();
    cy.data('reactome', { loadAnalysis: () => undefined });
    expect(styleOf(cy)).toBeUndefined();
    // As `bindToCytoscape` keeps it, which cannot run headless.
    const style = new Style(document.createElement('div'));
    cy.data('reactome', style);
    expect(styleOf(cy)).toBe(style);
  });
});
