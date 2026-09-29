import { provideZonelessChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { createCustomElement } from '@angular/elements';
import { MatIconRegistry } from '@angular/material/icon';
import { DiagramElementComponent } from './diagram-element.component';
import { rootGuards } from './embed-providers';

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
 */
class ReactomeDiagram extends HTMLElement {
  static observedAttributes = ATTRIBUTES;
  private view: HTMLElement | null = null;
  private pendingRemoval: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
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
    this.appendChild(view);
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
  // A default box, at zero specificity so any rule of the partner's wins: an
  // unknown element is inline, and an inline element ignores width and height.
  const defaults = document.createElement('style');
  defaults.textContent = `:where(${TAG}) { display: block; width: 800px; height: 500px; }`;
  document.head.appendChild(defaults);
  customElements.define(TAG, ReactomeDiagram);
  createApplication({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), ...rootGuards],
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
