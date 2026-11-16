import { Injectable, inject } from '@angular/core';
import { map, Observable, Subject } from 'rxjs';
import { DatabaseObject } from '../model/graph/database-object.model';
import { JSOGDeserializer, type JsogObject } from '../utils/JSOGDeserializer';
import { CONTENT_SERVICE } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class DatabaseObjectService {
  private http = inject(HttpClient);

  private readonly _ENHANCED_QUERY = `${CONTENT_SERVICE}/data/query/enhanced/v2/`;

  private _selectedObj: Subject<DatabaseObject> = new Subject<DatabaseObject>();
  public selectedObj$ = this._selectedObj.asObservable();

  setCurrentObj(obj: DatabaseObject) {
    this._selectedObj.next(obj);
  }

  fetchEnhancedEntry<T extends DatabaseObject>(
    stId: string,
    summariseReferenceEntity = false
  ): Observable<T> {
    const url = `${this._ENHANCED_QUERY}${stId}`;
    return this.http
      .get<JsogObject<T>>(url, {
        params: {
          includeRef: true,
          view: 'nested-aggregated',
          summariseReferenceEntity,
          includeDisease: true,
          // As the data state asks for it, so the two share an edge cache
          // entry (spec 011); true is the endpoint's default.
          fetchIncomingRelationships: true,
        },
      })
      .pipe(map((response) => new JSOGDeserializer().deserialize(response)));
  }
}
