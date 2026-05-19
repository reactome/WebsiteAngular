import {Component, effect, inject, OnInit, signal, viewChild} from '@angular/core';
import {DatePipe} from '@angular/common';
import {ActivatedRoute} from '@angular/router';
import {DomSanitizer} from '@angular/platform-browser';
import {MatIconRegistry} from '@angular/material/icon';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {of} from 'rxjs';

import {PageLayoutComponent} from '../../page-layout/page-layout.component';
import {SidebarComponent} from '../../sidebar/sidebar.component';
import {
  DescriptionTabComponent
} from '../../../../../pathway-browser/src/app/details/tabs/description-tab/description-tab.component';
import { DetailDownloadBarComponent } from './detail-download-bar/detail-download-bar.component';
import {SelectableObject} from '../../../../../pathway-browser/src/app/services/event.service';
import {UrlStateService} from '../../../../../pathway-browser/src/app/services/url-state.service';
import {DataStateService} from '../../../../../pathway-browser/src/app/services/data-state.service';
import {EntityService} from '../../../../../pathway-browser/src/app/services/entity.service';
import {InteractorService} from '../../../../../pathway-browser/src/app/interactors/services/interactor.service';
import {FigureService} from '../../../../../pathway-browser/src/app/details/tabs/description-tab/figure/figure.service';
import {SpeciesService} from '../../../../../pathway-browser/src/app/services/species.service';
import {DiagramService} from '../../../../../pathway-browser/src/app/services/diagram.service';
import {ParticipantService} from '../../../../../pathway-browser/src/app/services/participant.service';
import {IconService} from '../../../../../pathway-browser/src/app/services/icon.service';

import {DetailDataService} from '../../../services/detail-data.service';
import {DetailUrlState} from './providers/detail-url-state.provider';
import {DetailDataState} from './providers/detail-data-state.provider';
import {DetailEntityService} from './providers/detail-entity.provider';
import {DetailInteractorService} from './providers/detail-interactor.provider';
import {DetailFigureService} from './providers/detail-figure.provider';
import {DetailSpeciesService} from './providers/detail-species.provider';

@Component({
  selector: 'app-detail',
  standalone: true,
  imports: [PageLayoutComponent, DescriptionTabComponent, DetailDownloadBarComponent, MatProgressSpinner, SidebarComponent],
  providers: [
    {provide: UrlStateService, useClass: DetailUrlState},
    {provide: DataStateService, useClass: DetailDataState},
    {provide: EntityService, useClass: DetailEntityService},
    {provide: InteractorService, useClass: DetailInteractorService},
    {provide: FigureService, useClass: DetailFigureService},
    {provide: SpeciesService, useClass: DetailSpeciesService},
    DiagramService,
    {provide: ParticipantService, useValue: {getReferenceEntities: () => of([])}},
    DatePipe,
  ],
  templateUrl: './detail.component.html',
  styleUrl: './detail.component.scss',
})
export class DetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private detailDataService = inject(DetailDataService);
  private dataState = inject(DataStateService) as unknown as DetailDataState;
  private matIconRegistry = inject(MatIconRegistry);
  private domSanitizer = inject(DomSanitizer);
  private iconService = inject(IconService);

  obj = signal<SelectableObject | undefined>(undefined);
  loading = signal(true);
  error = signal(false);

  // Read the embedded description-tab so we can mirror its section TOC
  // into the left sidebar.
  private descriptionTab = viewChild(DescriptionTabComponent);
  tocItems = signal<{ key: string; label: string }[]>([]);
  selectedTocKey = signal('');

  selectTocItem(key: string) {
    this.descriptionTab()?.selectItem(key);
  }

  constructor() {
    this.registerIcons();

    // Sync the section TOC from the embedded cr-description-tab into the
    // local sidebar via an effect (not a computed): an effect runs AFTER
    // change detection, by which time the child's [obj] binding has
    // resolved. Doing this in a computed would touch the child's required
    // input mid-cycle and throw NG0950.
    effect(() => {
      const tab = this.descriptionTab();
      const entity = this.obj();
      if (!tab || !entity) {
        this.tocItems.set([]);
        this.selectedTocKey.set('');
        return;
      }
      try {
        this.tocItems.set(
          tab.elements
            .filter((e) => tab.isTOCIncluded(e.key))
            .map((e) => ({ key: e.key, label: e.label })),
        );
        this.selectedTocKey.set(tab.selectedKey());
      } catch {
        // Defensive: if the child still isn't fully initialised the effect
        // will re-run on the next cycle.
      }
    });
  }

  private registerIcons() {
    const speciesIcons = this.iconService.getSpeciesIcons();
    const generalIcons = this.iconService.getGeneralIcons();
    const reactomeSubjectIcons = this.iconService.getReactomeSubjectIcons();

    this.matIconRegistry.registerFontClassAlias('symbols', 'material-symbols-rounded');

    speciesIcons.forEach(icon => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/species/${icon.route}.svg`));
    });

    generalIcons.forEach(icon => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/general/${icon.route}.svg`));
    });

    Object.values(reactomeSubjectIcons).forEach((icon) => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/reactome-subject/${icon.route}.svg`));
    });
  }

  ngOnInit() {
    // Subscribe (not snapshot) so navigation between entity detail pages
    // -- /content/detail/A -> /content/detail/B reuses the same component
    // and would otherwise never re-fetch.
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (!id) {
        this.loading.set(false);
        this.error.set(true);
        return;
      }
      this.loading.set(true);
      this.error.set(false);
      this.obj.set(undefined);
      this.detailDataService.fetchEnhancedData<SelectableObject>(id).subscribe({
        next: (data) => {
          if (data) {
            this.obj.set(data);
            this.dataState.selectedElement.set(data);
          } else {
            this.error.set(true);
          }
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        }
      });
    });
  }
}
