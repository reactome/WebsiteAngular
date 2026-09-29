import { APP_ID, provideZonelessChangeDetection } from '@angular/core';
import {
  createApplication,
  ɵSharedStylesHost as SharedStylesHost,
} from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { createCustomElement } from '@angular/elements';
import { MatIconRegistry } from '@angular/material/icon';
import {
  CLEAR_SELECTION_EVENT,
  DiagramElementComponent,
  FIT_EVENT,
  HIGHLIGHT_EVENT,
} from './diagram-element.component';
import { rootGuards, ShadowRootsOnlyStylesHost } from './embed-providers';
import { EHLD_LEGEND_BASE } from '../../pathway-browser/src/app/services/ehld.service';

/** The element partners write. */
const TAG = 'reactome-diagram';
/** The Angular view it holds: an implementation detail, made afresh when needed. */
const VIEW = 'reactome-diagram-view';
/** The contract's attributes, each with its property, passed through to the view. */
const PROPERTIES = {
  pathway: 'pathway',
  select: 'select',
  flag: 'flag',
  analysisToken: 'analysis-token',
  analysisResource: 'analysis-resource',
  theme: 'theme',
} as const;
const ATTRIBUTES: string[] = Object.values(PROPERTIES);

/**
 * `<reactome-diagram>`: what a partner puts on their page.
 *
 * A plain element holding a fresh Angular view each time it is connected,
 * rather than the Angular element itself, because an Angular element cannot
 * come back once it has been removed:
 *  - Angular's shadow-DOM renderer calls attachShadow() whenever it creates the
 *    component, and an element that has a shadow root cannot be given another;
 *  - and Angular Elements (21.2) never clears its scheduled-destroy handle, so
 *    reconnecting after the destroy ran does not even try.
 * A single-page host app removes and re-adds elements all the time. Here each
 * connection gets a new view element, which has neither problem. Removal is
 * deferred a tick, so an element that is only moved keeps its diagram.
 *
 * The view lives in this element's own shadow root, not among its children:
 * there the partner's `reactome-diagram > *` rules cannot reach it, their
 * `innerHTML` and `children` do not see it, and cloning the element does not
 * copy it. The default box is a `:host` rule for the same reason -- any rule
 * of the partner's beats it, and nothing is added to their document.
 */
class ReactomeDiagram extends HTMLElement {
  static observedAttributes = ATTRIBUTES;
  private readonly root: ShadowRoot;
  private view: HTMLElement | null = null;
  private pendingRemoval: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    // An open root the partner already attached is reused rather than thrown on.
    this.root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const box = document.createElement('style');
    box.textContent = ':host { display: block; width: 800px; height: 500px; }';
    this.root.appendChild(box);
  }

  connectedCallback() {
    // A property set before this code loaded is an own property of the element
    // that hides the accessor below: take it, and set it through the accessor.
    for (const name of Object.keys(PROPERTIES)) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = (this as Record<string, unknown>)[name];
        delete (this as Record<string, unknown>)[name];
        if (value !== undefined) (this as Record<string, unknown>)[name] = value;
      }
    }
    if (this.pendingRemoval !== null) {
      clearTimeout(this.pendingRemoval);
      this.pendingRemoval = null;
      return;
    }
    const view = document.createElement(VIEW);
    view.style.cssText = 'display:block;width:100%;height:100%';
    for (const name of ATTRIBUTES) {
      const value = this.getAttribute(name);
      if (value !== null) view.setAttribute(name, value);
    }
    this.view = view;
    this.root.appendChild(view);
  }

  disconnectedCallback() {
    this.pendingRemoval = setTimeout(() => {
      this.pendingRemoval = null;
      this.view?.remove();
      this.view = null;
    });
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (!this.view) return;
    if (value === null) return this.view.removeAttribute(name);
    // Set to the value it already has: apply it again. The state it set can be
    // cleared from inside -- the flag banner, a background click -- while the
    // attribute still holds it, and an input set to its own value changes
    // nothing, so the partner could never flag that term again.
    if (old === value) this.view.removeAttribute(name);
    this.view.setAttribute(name, value);
  }

  /** Fits the whole diagram in view. */
  fit() {
    this.toReadyView(new Event(FIT_EVENT));
  }
  /** Clears the selection: the partner's, and one the reader clicked. */
  resetSelection() {
    this.removeAttribute(PROPERTIES.select);
    this.toReadyView(new Event(CLEAR_SELECTION_EVENT));
  }
  /** Makes an entity stand out, without selecting it. */
  highlight(id: string) {
    this.toView(new CustomEvent(HIGHLIGHT_EVENT, { detail: id }));
  }
  resetHighlight() {
    this.toView(new CustomEvent(HIGHLIGHT_EVENT));
  }

  /**
   * A method's request, to the view that carries it out. The view is only
   * listening once its own element is defined, after the diagram's code has
   * started -- later than this element, whose methods a page (or the old
   * widget's queue) can call as soon as it exists.
   */
  private toView(event: Event) {
    void customElements.whenDefined(VIEW).then(() => this.view?.dispatchEvent(event));
  }

  /**
   * A request that only means something to a view that is there: nothing is
   * drawn to fit, and nothing selected by the reader to clear, before it is.
   * Waiting for it instead, a clear sent before a queued select arrived after
   * that select had been applied, and undid it.
   */
  private toReadyView(event: Event) {
    if (customElements.get(VIEW)) this.view?.dispatchEvent(event);
  }
  /** Each the same as removing its attribute. */
  resetFlag() {
    this.removeAttribute(PROPERTIES.flag);
  }
  resetAnalysis() {
    this.removeAttribute(PROPERTIES.analysisToken);
  }
}

// Setting a property is the same as setting its attribute; null removes it.
for (const [property, attribute] of Object.entries(PROPERTIES)) {
  Object.defineProperty(ReactomeDiagram.prototype, property, {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute(attribute);
    },
    set(this: HTMLElement, value: string | null) {
      if (value === null || value === undefined) this.removeAttribute(attribute);
      else this.setAttribute(attribute, String(value));
    },
  });
}

// Loading this twice -- two script tags, or a partner's bundler plus ours --
// must be harmless: a second define() of the same name throws.
if (!customElements.get(TAG)) {
  // The partner's element exists from the start, so the page can size it and
  // listen to it; its view appears when the diagram code is ready.
  customElements.define(TAG, ReactomeDiagram);
  createApplication({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      // Not Angular's default 'ng', which a partner's own Angular app has too:
      // styles it rendered on the server are claimed by the app with that id.
      { provide: APP_ID, useValue: 'reactome-diagram' },
      { provide: SharedStylesHost, useClass: ShadowRootsOnlyStylesHost },
      // Beside this script, wherever it was loaded from -- not the partner's page.
      { provide: EHLD_LEGEND_BASE, useValue: new URL('EHLD-legend/', import.meta.url).href },
      ...rootGuards,
    ],
  })
    .then((app) => {
      app.injector
        .get(MatIconRegistry)
        .registerFontClassAlias('symbols', 'material-symbols-rounded');
      customElements.define(
        VIEW,
        createCustomElement(DiagramElementComponent, { injector: app.injector })
      );
    })
    .catch((error) => console.error('Could not start the Reactome diagram element', error));
}
