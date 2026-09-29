// @vitest-environment node
//
// The old widget's interface, window.Reactome.Diagram, as the classic loader
// defines it (contracts/legacy-widget-api.md). The loader is a plain script
// with no exports -- partners include it with a <script> tag -- so this runs
// the real file in a sandbox with a small fake page, rather than testing a
// copy of its logic.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const LOADER = readFileSync(
  path.join(process.cwd(), 'projects/reactome-diagram-element/src/loader/reactome-diagram.js'),
  'utf8'
);

/** An element that records what is done to it. */
function fakeElement(tag) {
  const listeners = {};
  const element = {
    tagName: tag.toUpperCase(),
    attributes: {},
    style: {},
    children: [],
    calls: [],
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      this.calls.push(['set', name, String(value)]);
    },
    removeAttribute(name) {
      delete this.attributes[name];
      this.calls.push(['remove', name]);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    dispatch(type, detail) {
      for (const fn of listeners[type] ?? []) fn({ type, detail });
    },
  };
  // The element's own methods, present once it is defined.
  for (const method of [
    'resetSelection',
    'resetFlag',
    'resetAnalysis',
    'highlight',
    'resetHighlight',
  ]) {
    element[method] = (...args) => element.calls.push([method, ...args]);
  }
  return element;
}

/** A page with one placeholder, and a custom-element registry whose definition the test releases. */
function page() {
  const holder = fakeElement('div');
  const head = fakeElement('head');
  let define;
  const defined = new Promise((resolve) => (define = resolve));
  const document = {
    head,
    currentScript: { src: 'https://example.org/embed/diagram/v1/reactome-diagram.js' },
    getElementById: (id) => (id === 'holder' ? holder : null),
    createElement: (tag) => fakeElement(tag),
    querySelector: () => null,
  };
  const window = { document, customElements: { whenDefined: () => defined } };
  window.window = window;
  const context = vm.createContext({ window, document, customElements: window.customElements });
  vm.runInContext(LOADER, context);
  const diagram = () => holder.children[0];
  return { window, holder, diagram, define: () => define() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Reactome.Diagram, from the classic loader', () => {
  it('is there as soon as the script has run, for pages that poll for it', () => {
    const { window } = page();
    expect(typeof window.Reactome?.Diagram?.create).toBe('function');
  });

  it('creates a diagram of the asked-for size in the placeholder', () => {
    const { window, diagram } = page();
    window.Reactome.Diagram.create({
      placeHolder: 'holder',
      width: 1130,
      height: 600,
      proxyPrefix: '/p',
    });
    expect(diagram().tagName).toBe('REACTOME-DIAGRAM');
    expect(diagram().style.width).toBe('1130px');
    expect(diagram().style.height).toBe('600px');
  });

  it('says which placeholder it could not find', () => {
    const { window } = page();
    expect(() => window.Reactome.Diagram.create({ placeHolder: 'nowhere' })).toThrow(/nowhere/);
  });

  it('queues calls made before the element is ready, and applies them in order', async () => {
    const { window, diagram, define } = page();
    const widget = window.Reactome.Diagram.create({ placeHolder: 'holder' });
    widget.resetFlaggedItems();
    widget.flagItems('CHEK1');
    widget.loadDiagram('R-HSA-69620');
    // Nothing yet: applied now, an attribute would overtake a queued method.
    expect(diagram().calls).toEqual([]);
    define();
    await settle();
    expect(diagram().calls).toEqual([
      ['resetFlag'],
      ['set', 'flag', 'CHEK1'],
      ['set', 'pathway', 'R-HSA-69620'],
    ]);
    // Once ready, a call applies at once.
    widget.selectItem('R-HSA-182558');
    expect(diagram().calls.at(-1)).toEqual(['set', 'select', 'R-HSA-182558']);
  });

  it('maps every method to the element', async () => {
    const { window, diagram, define } = page();
    const widget = window.Reactome.Diagram.create({ placeHolder: 'holder' });
    define();
    await settle();
    widget.loadDiagram('R-HSA-1');
    widget.selectItem('R-HSA-2');
    widget.resetSelection();
    widget.flagItems('AKT1');
    widget.resetFlaggedItems();
    widget.highlightItem('R-HSA-3');
    widget.resetHighlight();
    widget.setAnalysisToken('TOKEN', { resource: 'UNIPROT' });
    widget.setAnalysisToken('TOKEN2');
    widget.setAnalysisToken('TOKEN3', 'ENSEMBL');
    widget.resetAnalysis();
    widget.resize(400, 300);
    expect(diagram().calls).toEqual([
      ['set', 'pathway', 'R-HSA-1'],
      ['set', 'select', 'R-HSA-2'],
      ['resetSelection'],
      ['set', 'flag', 'AKT1'],
      ['resetFlag'],
      ['highlight', 'R-HSA-3'],
      ['resetHighlight'],
      ['set', 'analysis-resource', 'UNIPROT'],
      ['set', 'analysis-token', 'TOKEN'],
      ['set', 'analysis-resource', 'TOTAL'],
      ['set', 'analysis-token', 'TOKEN2'],
      ['set', 'analysis-resource', 'ENSEMBL'],
      ['set', 'analysis-token', 'TOKEN3'],
      ['resetAnalysis'],
    ]);
    expect(diagram().style).toMatchObject({ width: '400px', height: '300px' });
  });

  it('calls each handler with the arguments the old widget passed', () => {
    const { window, diagram } = page();
    const widget = window.Reactome.Diagram.create({ placeHolder: 'holder' });
    const seen = [];
    widget.onDiagramLoaded((stId) => seen.push(['loaded', stId]));
    widget.onObjectSelected((obj) => seen.push(['selected', obj]));
    widget.onObjectHovered((obj) => seen.push(['hovered', obj]));
    widget.onFlagsReset((...args) => seen.push(['flags', args.length]));
    widget.onAnalysisReset((...args) => seen.push(['analysis', args.length]));
    widget.onCanvasNotSupported(() => seen.push(['canvas']));
    // Two registrations for one event: both are called.
    widget.onDiagramLoaded((stId) => seen.push(['loaded again', stId]));

    const entity = { id: 'R-HSA-182558', name: 'CDKN1A,CDKN1B', schemaClass: 'DefinedSet' };
    const nothing = { id: null, name: null, schemaClass: null };
    diagram().dispatch('diagramloaded', { pathway: 'R-HSA-69620' });
    diagram().dispatch('entityselected', entity);
    diagram().dispatch('entityselected', nothing);
    diagram().dispatch('entityhovered', entity);
    diagram().dispatch('flagcleared', {});
    diagram().dispatch('analysiscleared', {});
    diagram().dispatch('diagramerror', { pathway: 'R-HSA-1', reason: 'not-found' });
    diagram().dispatch('diagramerror', { pathway: 'R-HSA-1', reason: 'unsupported' });

    const old = { stId: 'R-HSA-182558', displayName: 'CDKN1A,CDKN1B', schemaClass: 'DefinedSet' };
    expect(seen).toEqual([
      ['loaded', 'R-HSA-69620'],
      ['loaded again', 'R-HSA-69620'],
      ['selected', old],
      ['selected', null],
      ['hovered', old],
      ['flags', 0],
      ['analysis', 0],
      ['canvas'],
    ]);
  });

  it('does not replace a Reactome.Diagram the page already has', () => {
    const { window } = page();
    const first = window.Reactome.Diagram;
    vm.runInContext(LOADER, vm.createContext(window));
    expect(window.Reactome.Diagram).toBe(first);
  });
});
