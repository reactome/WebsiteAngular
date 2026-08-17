import { Component, OnInit, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { datasetFeature } from '../../../../state/dataset/dataset.selector';
import { filter, map, Observable } from 'rxjs';
import { PLoadingStatus } from '../../../../model/load-dataset.model';
import { isDefined } from '../../../../utilities/utils';
import { MAT_DIALOG_DATA, MatDialogContent, MatDialogClose } from '@angular/material/dialog';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'gsa-loading-progress',
  templateUrl: './loading-progress.component.html',
  styleUrls: ['./loading-progress.component.scss'],
  imports: [
    CdkScrollable,
    MatDialogContent,
    MatProgressSpinner,
    MatIcon,
    MatButton,
    MatDialogClose,
    AsyncPipe,
  ],
})
export class LoadingProgressComponent implements OnInit {
  store = inject(Store);
  data = inject<{
    datasetId: number;
  }>(MAT_DIALOG_DATA);

  loadingStatus$!: Observable<PLoadingStatus>;

  ngOnInit(): void {
    this.loadingStatus$ = this.store.select(datasetFeature.selectDataset(this.data.datasetId)).pipe(
      map((dataset) => dataset?.loadingStatus),
      filter(isDefined)
    );
  }
}
