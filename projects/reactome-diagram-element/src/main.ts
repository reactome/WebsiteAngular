import { APP_ID, provideZonelessChangeDetection } from '@angular/core';
import {
  createApplication,
  ɵSharedStylesHost as SharedStylesHost,
} from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { createCustomElement } from '@angular/elements';
import { MatIconRegistry } from '@angular/material/icon';
import { DiagramElementComponent } from './diagram-element.component';
import { rootGuards, ShadowRootsOnlyStylesHost } from './embed-providers';

/** The element partners write. */
const TAG = 'reactome-diagram';
/** The Angular view it holds: an implementation detail, made afresh when needed. */
const VIEW = 'reactome-diagram-view';
/** Attributes passed through to the view (the contract's attribute table). */
const ATTRIBUTES = ['pathway'];

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
    this.root = this.attachShadow({ mode: 'open' });
    const box = document.createElement('style');
    box.textContent = ':host { display: block; width: 800px; height: 500px; }';
    this.root.appendChild(box);
  }

  connectedCallback() {
    // A property set before this code loaded is an own property of the element
    // that hides the accessor below: take it, and set it through the accessor.
    for (const name of ATTRIBUTES) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = (this as Record<string, unknown>)[name];
        delete (this as Record<string, unknown>)[name];
        (this as Record<string, unknown>)[name] = value;
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

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (!this.view) return;
    if (value === null) this.view.removeAttribute(name);
    else this.view.setAttribute(name, value);
  }

  get pathway(): string | null {
    return this.getAttribute('pathway');
  }
  set pathway(value: string | null) {
    if (value === null) this.removeAttribute('pathway');
    else this.setAttribute('pathway', value);
  }
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
