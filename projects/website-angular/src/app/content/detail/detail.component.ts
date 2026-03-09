import {Component, inject, OnInit, signal} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {DomSanitizer} from '@angular/platform-browser';
import {MatIconRegistry} from '@angular/material/icon';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {of} from 'rxjs';

import {PageLayoutComponent} from '../../page-layout/page-layout.component';
import {
  DescriptionTabComponent
} from '../../../../../pathway-browser/src/app/details/tabs/description-tab/description-tab.component';
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

import {LocationsTreeComponent} from './locations-tree/locations-tree.component';
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
  imports: [PageLayoutComponent, DescriptionTabComponent, LocationsTreeComponent, MatProgressSpinner],
  providers: [
    {provide: UrlStateService, useClass: DetailUrlState},
    {provide: DataStateService, useClass: DetailDataState},
    {provide: EntityService, useClass: DetailEntityService},
    {provide: InteractorService, useClass: DetailInteractorService},
    {provide: FigureService, useClass: DetailFigureService},
    {provide: SpeciesService, useClass: DetailSpeciesService},
    {provide: DiagramService, useValue: {}},
    {provide: ParticipantService, useValue: {getReferenceEntities: () => of([])}},
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

  entityId = signal<string | null>(null);
  obj = signal<SelectableObject | undefined>(undefined);
  loading = signal(true);
  error = signal(false);

  constructor() {
    this.registerIcons();
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
    const id = this.route.snapshot.paramMap.get('id');
    this.entityId.set(id);
    if (!id) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }

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
  }
}
