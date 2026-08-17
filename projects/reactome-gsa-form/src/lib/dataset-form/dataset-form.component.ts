import { Component, input, OnDestroy, OnInit, viewChild, inject } from '@angular/core';
import {
  MatStepper,
  MatStep,
  MatStepLabel,
  MatStepperNext,
  MatStepperPrevious,
} from '@angular/material/stepper';
import { MatDialog } from '@angular/material/dialog';
import { ScrollService } from '../services/scroll.service';
import { CdkStep, StepperSelectionEvent } from '@angular/cdk/stepper';
import { Store } from '@ngrx/store';
import { datasetFeature } from '../state/dataset/dataset.selector';
import { delay, distinctUntilChanged, Observable, share } from 'rxjs';
import { PDataset } from '../state/dataset/dataset.state';
import { datasetActions } from '../state/dataset/dataset.actions';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { Method } from '../state/method/method.state';
import { DownloadDatasetService } from '../services/download-dataset.service';
import { TourUtilsService } from '../services/tour-utils.service';
import { MatExpansionPanel, MatExpansionPanelHeader } from '@angular/material/expansion';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton, MatFabButton, MatButton } from '@angular/material/button';
import { SelectDatasetComponent } from './datasets/select-dataset/select-dataset.component';
import { AnnotateDatasetComponent } from './datasets/annotate-dataset/annotate-dataset.component';
import { TourAnchorMatMenuDirective } from 'ngx-ui-tour-md-menu';
import { StatisticalDesignComponent } from './datasets/statistical-design/statistical-design.component';
import { ParamDatasetComponent } from './datasets/param-dataset/param-dataset.component';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'gsa-dataset-form',
  templateUrl: './dataset-form.component.html',
  styleUrls: ['./dataset-form.component.scss'],
  imports: [
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatTooltip,
    MatIcon,
    MatIconButton,
    MatStepper,
    MatStep,
    MatStepLabel,
    SelectDatasetComponent,
    MatFabButton,
    MatStepperNext,
    MatStepperPrevious,
    AnnotateDatasetComponent,
    TourAnchorMatMenuDirective,
    StatisticalDesignComponent,
    ParamDatasetComponent,
    MatButton,
    AsyncPipe,
  ],
})
@UntilDestroy()
export class DatasetFormComponent implements OnInit, OnDestroy {
  dialog = inject(MatDialog);
  tour = inject(TourUtilsService);
  download = inject(DownloadDatasetService);
  scrollService = inject(ScrollService);
  private store = inject(Store);

  readonly datasetId = input.required<number>();
  readonly method = input.required<Method>();

  public readonly stepper = viewChild.required<MatStepper>('nestedStepper');
  readonly selectStep = viewChild.required<CdkStep>('selectStep');
  readonly annotateStep = viewChild.required<CdkStep>('annotateStep');
  readonly statisticalDesignStep = viewChild.required<CdkStep>('statisticalDesignStep');

  dataset$!: Observable<PDataset | undefined>;
  summaryComplete$!: Observable<boolean>;
  annotationComplete$!: Observable<boolean>;
  statisticalDesignComplete$!: Observable<boolean>;
  parametersComplete$!: Observable<boolean>;

  ngOnInit(): void {
    this.dataset$ = this.store.select(datasetFeature.selectDataset(this.datasetId()));
    this.summaryComplete$ = this.store
      .select(datasetFeature.selectSummaryComplete(this.datasetId()))
      .pipe(distinctUntilChanged(), share());
    this.summaryComplete$
      .pipe(delay(0), untilDestroyed(this))
      .subscribe(() => this.stepper().next());
    this.annotationComplete$ = this.store
      .select(datasetFeature.selectAnnotationComplete(this.datasetId()))
      .pipe(distinctUntilChanged(), share());
    this.statisticalDesignComplete$ = this.store
      .select(datasetFeature.selectStatisticalDesignComplete(this.datasetId()))
      .pipe(distinctUntilChanged(), share());
    this.parametersComplete$ = this.store
      .select(datasetFeature.selectParametersComplete(this.datasetId()))
      .pipe(distinctUntilChanged(), share());
  }

  ngOnDestroy(): void {
    this.store.dispatch(datasetActions.delete({ id: this.datasetId() }));
  }

  deleteDataset($event: MouseEvent) {
    $event.stopPropagation();
    this.store.dispatch(datasetActions.delete({ id: this.datasetId() }));
  }

  saveData() {
    this.store.dispatch(datasetActions.save({ id: this.datasetId() }));
  }

  updateScroll() {
    setTimeout(() => this.scrollService.triggerResize(), 300);
  }

  stepChange($event: StepperSelectionEvent) {
    switch ($event.selectedStep) {
      case this.selectStep():
        this.store.dispatch(datasetActions.clear({ id: this.datasetId() }));
        break;
      case this.annotateStep():
        break;
      case this.statisticalDesignStep():
        break;
    }
  }
}
