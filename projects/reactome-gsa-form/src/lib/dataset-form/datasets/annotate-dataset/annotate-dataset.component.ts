import { Component, input, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';

import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { filter, map, Observable } from 'rxjs';
import { Store } from '@ngrx/store';
import { PDataset } from '../../../state/dataset/dataset.state';
import { datasetFeature } from '../../../state/dataset/dataset.selector';
import { datasetActions } from '../../../state/dataset/dataset.actions';
import { isDefined } from '../../../utilities/utils';
import { Settings, ReactomeTableModule } from 'reactome-table';
import { NgClass, AsyncPipe } from '@angular/common';
import { TourAnchorMatMenuDirective } from 'ngx-ui-tour-md-menu';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

@Component({
  selector: 'gsa-annotate-dataset',
  templateUrl: './annotate-dataset.component.html',
  styleUrls: ['./annotate-dataset.component.scss'],
  imports: [
    FormsModule,
    ReactiveFormsModule,
    NgClass,
    TourAnchorMatMenuDirective,
    MatFormField,
    MatLabel,
    MatInput,
    ReactomeTableModule,
    AsyncPipe,
  ],
})
export class AnnotateDatasetComponent implements OnInit {
  private formBuilder = inject(FormBuilder);
  private responsive = inject(BreakpointObserver);
  private store = inject(Store);

  readonly datasetId = input.required<number>();
  dataset$!: Observable<PDataset | undefined>;
  isRibo$!: Observable<boolean>;

  annotateDataStep: FormGroup;
  tableSettings!: Partial<Settings>;
  screenIsSmall: boolean = false;

  constructor() {
    this.annotateDataStep = this.formBuilder.group({
      address: ['', Validators.required],
    });
  }

  ngOnInit() {
    this.tableSettings = {
      renameRows: false,
      addRow: false,
      deleteRow: false,
      dropReplace: false,
    };

    this.dataset$ = this.store.select(datasetFeature.selectDataset(this.datasetId()));
    this.isRibo$ = this.dataset$.pipe(
      filter(isDefined),
      map((dataset) => dataset.summary?.type === 'ribo_seq')
    );

    this.responsive
      .observe(Breakpoints.Small)
      .subscribe((result) => (this.screenIsSmall = result.matches));
  }

  onTableUpdate(table: string[][]) {
    this.store.dispatch(
      datasetActions.setAnnotations({ annotations: table, id: this.datasetId() })
    );
  }

  updateTitle(value: string) {
    this.store.dispatch(
      datasetActions.updateSummary({
        update: {
          id: this.datasetId(),
          changes: {
            title: value,
          },
        },
      })
    );
  }

  protected readonly datasetActions = datasetActions;
}
