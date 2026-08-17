import { computed, Injectable, signal } from '@angular/core';
import { SpeciesService } from '../../../../../../pathway-browser/src/app/services/species.service';
import { Species } from '../../../../../../pathway-browser/src/app/model/graph/species.model';

@Injectable()
export class DetailSpeciesService implements Partial<SpeciesService> {
  readonly defaultSpecies: Species = {
    displayName: 'Homo sapiens',
    taxId: '9606',
    dbId: 48887,
    shortName: 'H. sapiens',
    abbreviation: 'HSA',
    schemaClass: 'Species',
  };

  readonly currentSpecies = signal<Species>(this.defaultSpecies);
  readonly allShortenSpecies = computed(() => undefined);
}

export const detailSpeciesProvider = {
  provide: SpeciesService,
  useClass: DetailSpeciesService,
};
