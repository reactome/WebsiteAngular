import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import { EntityService } from '../../../../../../pathway-browser/src/app/services/entity.service';
import { CONTENT_SERVICE } from '../../../../../../pathway-browser/src/environments/environment';
import { PhysicalEntity } from '../../../../../../pathway-browser/src/app/model/graph/physical-entity/physical-entity.model';
import { Pathway } from '../../../../../../pathway-browser/src/app/model/graph/event/pathway.model';
import { DatabaseObject } from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';
import { ReferenceEntity } from '../../../../../../pathway-browser/src/app/model/graph/reference-entity/reference-entity.model';
import { DataKeys, Labels } from '../../../../../../pathway-browser/src/app/constants/constants';
import {
  JSOGDeserializer,
  JSOGObject,
} from '../../../../../../pathway-browser/src/app/utils/JSOGDeserializer';

@Injectable()
export class DetailEntityService implements Partial<EntityService> {
  private http = inject(HttpClient);

  readonly eventId = signal<string | undefined>(undefined);
  selectedElement$ = of(undefined);

  _refEntities: any = { value: signal(null) };
  readonly refEntities = signal(null);

  getOtherForms(stId: string): Observable<PhysicalEntity[]> {
    const url = `${CONTENT_SERVICE}/data/entity/${stId}/otherForms`;
    return this.http.get<PhysicalEntity[]>(url);
  }

  // The description panel's "Other Pathways". Unlike EntityService's, no
  // species: a content page's species is always human (DetailSpeciesService),
  // and an object's pathways are its own species' anyway -- filtered by human,
  // a mouse entity's ten pathways were a 404 and the section vanished. A 404 is
  // "none", anything else an error the panel reports.
  getParticipatingPathways(stId: string): Observable<Pathway[]> {
    const url = `${CONTENT_SERVICE}/data/pathways/low/entity/${stId}`;
    return this.http
      .get<Pathway[]>(url)
      .pipe(
        catchError((error: unknown) =>
          error instanceof HttpErrorResponse && error.status === 404
            ? of([] as Pathway[])
            : throwError(() => error)
        )
      );
  }

  // Null for an unknown id: see EntityService.getEntityInDepth.
  getEntityInDepth<E extends DatabaseObject>(
    id: string | number,
    depth: number
  ): Observable<E | null> {
    const url = `${CONTENT_SERVICE}/data/entity/${id}/in-depth`;
    return this.http
      .get<E | null>(url, {
        params: {
          includeRef: true,
          view: 'nested-aggregated',
          attributes: 'species,compartment,referenceEntity',
          maxDepth: depth,
        },
      })
      .pipe(map((entity) => (entity === null ? null : this.flattenReferences(entity))));
  }

  getEventInDepth<E extends DatabaseObject>(id: string | number, depth: number): Observable<E> {
    const url = `${CONTENT_SERVICE}/data/event/${id}/in-depth`;
    return this.http
      .get<E>(url, {
        params: {
          includeRef: true,
          view: 'nested-aggregated',
          attributes: 'species,compartment',
          maxDepth: depth,
        },
      })
      .pipe(map(this.flattenReferences));
  }

  getGroupedData<T>(data: T[], getKey: (item: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    const uniqueKeys = [...new Set(data.map((item) => getKey(item)))];
    uniqueKeys.forEach((key) => {
      grouped.set(
        key,
        data.filter((item) => getKey(item) === key)
      );
    });
    return grouped;
  }

  getTransformedExternalRef(refEntity: ReferenceEntity | undefined) {
    if (!refEntity) return [];
    const externalRef = { ...refEntity };
    const properties = [
      { key: DataKeys.DISPLAY_NAME, label: Labels.EXTERNAL_REFERENCE },
      { key: 'geneName', label: 'Gene Names' },
      { key: 'chain', label: 'Chain' },
      { key: 'referenceGene', label: 'Reference Genes' },
      { key: 'referenceTranscript', label: 'Reference Transcript' },
    ];
    const results: { label: string; value: any }[] = [];
    for (const property of properties) {
      const value = (externalRef as any)[property.key];
      if (!value) continue;
      results.push({ label: property.label || property.key, value });
    }
    return results;
  }

  loadRefEntities(id: string) {
    this.eventId.set(id);
  }

  private flattenReferences<T>(response: T): T {
    const deserializer = new JSOGDeserializer();
    return deserializer.deserialize<T>(response as JSOGObject);
  }
}

export const detailEntityProvider = {
  provide: EntityService,
  useClass: DetailEntityService,
};
