import { Component, input, model, inject } from '@angular/core';
import { Species } from '../model/graph/species.model';
import { SpeciesService } from '../services/species.service';
import { UntilDestroy } from '@ngneat/until-destroy';
import { DataStateService } from '../services/data-state.service';
import { isDefined } from '../services/utils';
import { UrlStateService } from '../services/url-state.service';
import { MatSelectionList, MatListOption } from '@angular/material/list';
import { MatIcon } from '@angular/material/icon';
import { IconService } from '../services/icon.service';

@Component({
  selector: 'cr-species',
  templateUrl: './species.component.html',
  styleUrls: ['./species.component.scss'],
  standalone: true,
  imports: [MatSelectionList, MatListOption, MatIcon],
})
@UntilDestroy()
export class SpeciesComponent {
  speciesService = inject(SpeciesService);
  private dataState = inject(DataStateService);
  private state = inject(UrlStateService);
  private iconService = inject(IconService);

  readonly pathwayId = model.required<string>();
  readonly visibility = input({
    species: false,
    interactor: false,
  });

  private readonly availableSpeciesIcons = new Set<string>();

  constructor() {
    this.availableSpeciesIcons = new Set(
      this.iconService.getSpeciesIcons().map((icon) => icon.name)
    );
  }

  onSpeciesChange(newSpecies: Species) {
    this.speciesService.currentSpecies.set(newSpecies);

    this.speciesService
      .getClosestOrthologPathwayWithSelect(
        this.state.select(),
        [
          ...(this.dataState.currentPathway()?.ancestors || []),
          this.dataState.currentPathway(),
        ].filter(isDefined),
        newSpecies
      )
      .subscribe(({ pathway, map }) => {
        this.speciesService.updateQueryParams(map, pathway);
        this.visibility().species = false;
      });
  }

  getSpeciesIconName(species: Species): string {
    const normalizedTaxId = (species.taxId || '').replace(/\D/g, '');
    return this.availableSpeciesIcons.has(normalizedTaxId)
      ? normalizedTaxId
      : this.speciesService.defaultSpecies.taxId;
  }
}
