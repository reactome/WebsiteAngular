import {inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable, of} from 'rxjs';
import {InteractorService} from '../../../../../../pathway-browser/src/app/interactors/services/interactor.service';
import {CONTENT_SERVICE} from '../../../../../../pathway-browser/src/environments/environment';
import {CustomInteraction} from '../../../../../../pathway-browser/src/app/interactors/model/interactor.model';

@Injectable()
export class DetailInteractorService implements Partial<InteractorService> {
  private http = inject(HttpClient);

  currentResource = signal<any>({type: null, name: null});
  identifiers = '';

  getCustomInteractorsByAcc(acc: string): Observable<CustomInteraction[]> {
    const url = `${CONTENT_SERVICE}/interactors/static/molecule/enhanced/${acc}/details`;
    return this.http.get<CustomInteraction[]>(url);
  }
}

export const detailInteractorProvider = {
  provide: InteractorService,
  useClass: DetailInteractorService,
};
