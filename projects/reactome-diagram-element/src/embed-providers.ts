import {
  APP_ID,
  CSP_NONCE,
  DOCUMENT,
  ElementRef,
  inject,
  Injectable,
  PLATFORM_ID,
  Provider,
  signal,
} from '@angular/core';
import { ɵSharedStylesHost as SharedStylesHost } from '@angular/platform-browser';
import { OverlayContainer } from '@angular/cdk/overlay';
import { AriaDescriber } from '@angular/cdk/a11y';
import { UrlStateService } from '../../pathway-browser/src/app/services/url-state.service';
import { DarkService } from '../../pathway-browser/src/app/services/dark.service';
import { MemoryState } from './memory-state';
import {
  AnalysisService,
  STYLE_ROOT,
} from '../../pathway-browser/src/app/services/analysis.service';
import { CitationService } from '../../pathway-browser/src/app/services/citation.service';
import { DataStateService } from '../../pathway-browser/src/app/services/data-state.service';
import { EhldService } from '../../pathway-browser/src/app/services/ehld.service';
import { EntityService } from '../../pathway-browser/src/app/services/entity.service';
import { EventService } from '../../pathway-browser/src/app/services/event.service';
import { FigureService } from '../../pathway-browser/src/app/details/tabs/description-tab/figure/figure.service';
import { InteractorService } from '../../pathway-browser/src/app/interactors/services/interactor.service';
import { SpeciesService } from '../../pathway-browser/src/app/services/species.service';
import { HierarchyHoverService } from '../../pathway-browser/src/app/services/hierarchy-hover.service';

/**
 * Component styles, written into the elements' shadow roots and nowhere else.
 *
 * Angular writes every component's styles to each shadow root it renders and
 * to `document.head` as well, always. For components that are not themselves in
 * shadow DOM -- Material's slider, tooltip and icon, the CDK's overlay rules --
 * that is the partner's head: our `.mdc-slider` and `.cdk-overlay-container`
 * rules, at our versions, applied to their page and any Material of theirs.
 * Nothing of ours renders outside a shadow root, so the head is dropped as a
 * host. Private Angular API (ɵ): the e2e check that the partner's head gains
 * nothing is what notices if it changes shape.
 */
@Injectable()
export class ShadowRootsOnlyStylesHost extends SharedStylesHost {
  constructor() {
    const doc = inject(DOCUMENT);
    super(doc, inject(APP_ID), inject(CSP_NONCE, { optional: true }), inject(PLATFORM_ID));
    this.removeHost(doc.head);
  }
}

/**
 * Tooltip text as an accessible description, on the control itself.
 *
 * The CDK's AriaDescriber puts every message in a container it appends to
 * `document.body` and points `aria-describedby` at it. On a partner's page that
 * container is in their layout -- unstyled, since its visually-hidden rule is
 * in our shadow roots now, it made the page 650px taller -- and the reference
 * could not work anyway: an id in the document is out of reach from inside a
 * shadow root. The controls have no other accessible text, so the message goes
 * where assistive technology can read it.
 */
@Injectable()
class EmbedAriaDescriber implements Pick<AriaDescriber, 'describe' | 'removeDescription'> {
  describe(hostElement: Element, message: string | HTMLElement): void {
    const text = typeof message === 'string' ? message : message.textContent;
    if (text?.trim()) hostElement.setAttribute('aria-description', text);
  }

  removeDescription(hostElement: Element): void {
    hostElement.removeAttribute('aria-description');
  }
}

/**
 * The colour scheme, set by the element's `theme` attribute.
 *
 * The browser's DarkService reads and writes localStorage and toggles `dark` on
 * <body> -- on a partner's page, their storage and their body.
 */
@Injectable()
class EmbedDarkService implements Pick<DarkService, keyof DarkService> {
  readonly isDark = signal(false);
}

/**
 * Overlays -- tooltips, and the popup's dialogs -- inside the element.
 *
 * The CDK puts its overlay container on document.body: outside the shadow root,
 * where the diagram's styles do not reach, so a tooltip would render unstyled
 * on the partner's page. Material looks the container up through the injector
 * of the component asking (createOverlayRef), so providing this one per element
 * is enough.
 */
@Injectable()
class ShadowRootOverlayContainer extends OverlayContainer {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected override _createContainer(): void {
    super._createContainer();
    const root = this.host.nativeElement.shadowRoot;
    if (root && this._containerElement) root.appendChild(this._containerElement);
  }
}

/**
 * Provided per element, so two diagrams on one page never share state.
 *
 * Not just the state: every root service that reads it, directly or through
 * another, is re-provided here too. A root service injects from the root
 * injector, so it would never see this element's MemoryState -- and the root
 * has none to give it. The list is every @Injectable that depends,
 * transitively, on UrlStateService or DarkService, bar the Reacfoam overview's
 * two (the element does not draw one); `rootGuards` below makes a service
 * missing from it fail loudly instead of reaching for a router.
 */
export const embedProviders: Provider[] = [
  MemoryState,
  { provide: UrlStateService, useExisting: MemoryState },
  { provide: DarkService, useClass: EmbedDarkService },
  { provide: OverlayContainer, useClass: ShadowRootOverlayContainer },
  { provide: AriaDescriber, useClass: EmbedAriaDescriber },
  // The analysis palette reads the colour tokens from here: the element's own
  // host, where they are defined, not the partner's body, where they are not.
  {
    provide: STYLE_ROOT,
    useFactory: () => inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
  },
  AnalysisService,
  CitationService,
  DataStateService,
  EhldService,
  EntityService,
  EventService,
  FigureService,
  InteractorService,
  SpeciesService,
  // A hovered event, shared at the root: two illustrations on one page lit
  // each other's regions.
  HierarchyHoverService,
];

function perElementOnly(name: string): () => never {
  return () => {
    throw new Error(
      `${name} was asked for from the embedded diagram's root injector. It must be ` +
        'provided per element (embedProviders), or it reads the host page instead.'
    );
  };
}

/** For the application's root: a state-reading service resolved there is a bug. */
export const rootGuards: Provider[] = [
  { provide: UrlStateService, useFactory: perElementOnly('UrlStateService') },
  { provide: DarkService, useFactory: perElementOnly('DarkService') },
];
