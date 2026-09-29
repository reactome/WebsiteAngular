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
function page({ customElements = true, readyState = 'loading', ready } = {}) {
  const holder = fakeElement('div');
  const head = fakeElement('head');
  let define;
  const defined = new Promise((resolve) => (define = resolve));
  const loadedListeners = [];
  const document = {
    readyState,
    addEventListener: (type, fn) => type === 'DOMContentLoaded' && loadedListeners.push(fn),
    head,
    currentScript: { src: 'https://example.org/embed/diagram/v1/reactome-diagram.js' },
    getElementById: (id) => (id === 'holder' ? holder : null),
    createElement: (tag) => fakeElement(tag),
    querySelector: () => null,
  };
  const window = { document, setTimeout };
  if (customElements) window.customElements = { whenDefined: () => defined };
  if (ready) window.onReactomeDiagramReady = ready;
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(LOADER, context);
  const diagram = () => holder.children[0];
  const parsed = () => loadedListeners.forEach((fn) => fn());
  return { window, holder, diagram, define: () => define(), parsed };
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

  it("calls the page's onReactomeDiagramReady once the page has parsed, as the old widget did", async () => {
    // The old widget's documented start: the page defines this, the widget
    // calls it when it is ready, and create() is called inside it.
    let calls = 0;
    const { parsed } = page({ ready: () => calls++ });
    expect(calls).toBe(0);
    parsed();
    expect(calls).toBe(1);
  });

  it('calls it on the next turn when the page had already parsed', async () => {
    let calls = 0;
    page({ readyState: 'complete', ready: () => calls++ });
    expect(calls).toBe(0);
    await settle();
    expect(calls).toBe(1);
  });

  it('leaves nothing of its own on the window but Reactome', () => {
    const { window } = page();
    const own = Object.keys(window).filter(
      (key) => !['document', 'setTimeout', 'customElements', 'window'].includes(key)
    );
    expect(own).toEqual(['Reactome']);
  });

  it('says the browser cannot show it, rather than throwing, without custom elements', async () => {
    const { window } = page({ customElements: false });
    const widget = window.Reactome.Diagram.create({ placeHolder: 'holder' });
    let told = 0;
    widget.onCanvasNotSupported(() => told++);
    await settle();
    expect(told).toBe(1);
  });
});
