import { ElementRef, inject, Injectable, Provider, signal } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { UrlStateService } from '../../pathway-browser/src/app/services/url-state.service';
import { DarkService } from '../../pathway-browser/src/app/services/dark.service';
import { MemoryState } from './memory-state';
import { AnalysisService } from '../../pathway-browser/src/app/services/analysis.service';
import { CitationService } from '../../pathway-browser/src/app/services/citation.service';
import { DataStateService } from '../../pathway-browser/src/app/services/data-state.service';
import { EhldService } from '../../pathway-browser/src/app/services/ehld.service';
import { EntityService } from '../../pathway-browser/src/app/services/entity.service';
import { EventService } from '../../pathway-browser/src/app/services/event.service';
import { FigureService } from '../../pathway-browser/src/app/details/tabs/description-tab/figure/figure.service';
import { InteractorService } from '../../pathway-browser/src/app/interactors/services/interactor.service';
import { SpeciesService } from '../../pathway-browser/src/app/services/species.service';

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
  AnalysisService,
  CitationService,
  DataStateService,
  EhldService,
  EntityService,
  EventService,
  FigureService,
  InteractorService,
  SpeciesService,
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
