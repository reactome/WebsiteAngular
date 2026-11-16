import { Component, OnInit, input, inject } from '@angular/core';
import { PDatasetSource } from '../../../../../state/dataset-source/dataset-source.state';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { datasetSourceActions } from '../../../../../state/dataset-source/dataset-source.action';
import { datasetSourceFeature } from '../../../../../state/dataset-source/dataset-source.selector';
import { datasetActions } from '../../../../../state/dataset/dataset.actions';
import { Parameter } from '../../../../../model/parameter.model';
import type { LoadParameter } from '../../../../../model/load-dataset.model';
import { TourAnchorMatMenuDirective } from 'ngx-ui-tour-md-menu';
import { AsyncPipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { SearchComponent } from './search/search.component';
import { FormsModule } from '@angular/forms';
import { MethodParameterComponent } from '../../../../../utilities/method-parameter/method-parameter.component';
import { MatButton } from '@angular/material/button';

/**
 * The parameters an import sends, each value as its text; none while a field is
 * empty. An empty one threw here, so the Import button did nothing; it still
 * sends nothing.
 */
export function loadParameters(parameters: Parameter[]): LoadParameter[] | undefined {
  const sent: LoadParameter[] = [];
  for (const { name, value } of parameters) {
    if (value === undefined) return undefined;
    sent.push({ name, value: value.toString() });
  }
  return sent;
}

@Component({
  selector: 'gsa-external-data',
  templateUrl: './external-data.component.html',
  styleUrls: ['./external-data.component.scss'],
  imports: [
    TourAnchorMatMenuDirective,
    MatIcon,
    SearchComponent,
    FormsModule,
    MethodParameterComponent,
    MatButton,
    AsyncPipe,
  ],
})
export class ExternalDataComponent implements OnInit {
  private store = inject(Store);

  readonly source = input.required<PDatasetSource>();
  readonly datasetId = input.required<number>();
  isSelected$!: Observable<boolean>;

  ngOnInit(): void {
    this.isSelected$ = this.store.select(datasetSourceFeature.selectIsSelected(this.source()));
  }

  select(): void {
    this.store.dispatch(datasetSourceActions.select({ toBeSelected: this.source() }));
  }

  loadData(parameters: Parameter[]): void {
    const sent = loadParameters(parameters);
    if (!sent) return;
    this.store.dispatch(
      datasetActions.load({ id: this.datasetId(), resourceId: this.source().id, parameters: sent })
    );
  }

  updateParam(param: Parameter) {
    this.store.dispatch(datasetSourceActions.setParameter({ id: this.source().id, param }));
  }
}
