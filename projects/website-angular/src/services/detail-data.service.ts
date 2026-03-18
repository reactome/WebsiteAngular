import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {map, Observable, of} from 'rxjs';
import {CONTENT_SERVICE} from '../../../../projects/pathway-browser/src/environments/environment';
import {JSOGDeserializer, JSOGObject} from '../../../../projects/pathway-browser/src/app/utils/JSOGDeserializer';
import {DatabaseObject} from '../../../../projects/pathway-browser/src/app/model/graph/database-object.model';

@Injectable({
  providedIn: 'root'
})
export class DetailDataService {

  constructor(private http: HttpClient) {
  }

  fetchEnhancedData<T extends DatabaseObject>(id: string | number | null): Observable<T | undefined> {
    if (id === null) return of(undefined);
    const url = `${CONTENT_SERVICE}/data/query/enhanced/v2/${id}`;
    return this.http.get<T>(url, {
      params: {
        fetchIncomingRelationships: true,
        summariseReferenceEntity: true,
        includeDisease: true,
        includeRef: true,
        view: 'nested-aggregated'
      }
    }).pipe(map(response => {
      const deserializer = new JSOGDeserializer();
      return deserializer.deserialize<T>(response as JSOGObject);
    }));
  }
}
