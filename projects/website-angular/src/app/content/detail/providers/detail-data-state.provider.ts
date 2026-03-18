import {computed, inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {DataStateService} from '../../../../../../pathway-browser/src/app/services/data-state.service';
import {SelectableObject} from '../../../../../../pathway-browser/src/app/services/event.service';
import {DatabaseObject} from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';
import {JSOGDeserializer, JSOGObject} from '../../../../../../pathway-browser/src/app/utils/JSOGDeserializer';
import {CONTENT_SERVICE} from '../../../../../../pathway-browser/src/environments/environment';
import {rxResource} from '@angular/core/rxjs-interop';
import {map, Observable, of} from 'rxjs';

@Injectable()
export class DetailDataState implements Partial<DataStateService> {
  private http = inject(HttpClient);

  readonly selectedElement = signal<SelectableObject | undefined>(undefined);
  readonly selectedElementLoading = signal(false);
  readonly currentPathway = computed(() => undefined);
  readonly hasDetail = computed(() => !!this.selectedElement());
  readonly selectIsSummary = computed(() => false);
  readonly selectedPathwayStId = signal<string | undefined>(undefined);

  readonly flagIdentifiers = computed<string[]>(() => []);

  flagResource = rxResource({
    request: () => null,
    loader: () => of({matches: [], interactsWith: []})
  });

  fetchEnhancedData<T extends DatabaseObject>(id: string | number | null, params?: Partial<{
    fetchIncomingRelationships: boolean,
    summariseReferenceEntity: boolean,
    includeDisease: boolean
  }>): Observable<T | undefined> {
    if (id === null) return of(undefined);
    const url = `${CONTENT_SERVICE}/data/query/enhanced/v2/${id}`;
    return this.http.get<T>(url, {
      params: {
        fetchIncomingRelationships: true,
        summariseReferenceEntity: true,
        includeDisease: true,
        ...params,
        includeRef: true,
        view: 'nested-aggregated'
      }
    }).pipe(map(this.flattenReferences));
  }

  flattenReferences<T>(response: T): T {
    const deserializer = new JSOGDeserializer();
    return deserializer.deserialize<T>(response as JSOGObject);
  }
}

export const detailDataStateProvider = {
  provide: DataStateService,
  useClass: DetailDataState,
};
