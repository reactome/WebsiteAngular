import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  signal,
  input,
  OnDestroy,
  viewChild,
  DestroyRef,
  inject,
} from '@angular/core';
import { MatStepper } from '@angular/material/stepper';
import { outputFromObservable, toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { methodFeature } from './state/method/method.selector';
import { combineLatest, filter, firstValueFrom, map, Observable, take } from 'rxjs';
import { datasetFeature } from './state/dataset/dataset.selector';
import { datasetActions } from './state/dataset/dataset.actions';
import { analysisActions } from './state/analysis/analysis.actions';
import { Dataset } from './state/dataset/dataset.state';
import { CdkStep, StepperSelectionEvent } from '@angular/cdk/stepper';
import { analysisFeature } from './state/analysis/analysis.selector';
import { isDefined } from './utilities/utils';
import { MatDialog } from '@angular/material/dialog';
import { CancelDialogComponent } from './cancel-dialog/cancel-dialog.component';
import { TourUtilsService } from './services/tour-utils.service';
import { HeightService } from './services/height.service';
import { AnalysisResult } from './model/analysis-result.model';
import { MatIconRegistry } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { TourComponent } from './tour/tour.component';
import { OptionsComponent } from './options/options.component';

@Component({
  selector: 'gsa-form',
  templateUrl: './gsa-form.component.html',
  styleUrls: ['./gsa-form.component.scss'],
  standalone: false,
})
export class GsaFormComponent implements AfterViewInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private store = inject(Store);
  tour = inject(TourUtilsService);
  height = inject(HeightService);
  private dialog = inject(MatDialog);
  private icons = inject(MatIconRegistry);
  private route = inject(ActivatedRoute);

  readonly stepper = viewChild.required<MatStepper>('stepper');
  // The stepper is moved on the next tick after a cancel or a restart. The
  // stepper is inside *ngrxLet and its queries are required, so a move that
  // lands after the form is destroyed would throw NG0951; each is cancelled
  // on destroy instead.
  private readonly destroyRef = inject(DestroyRef);
  private later(move: () => void) {
    const timer = setTimeout(() => {
      unregister();
      move();
    });
    const unregister = this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  readonly setMethodStep = viewChild.required<CdkStep>('setMethodStep');
  readonly addDataStep = viewChild.required<CdkStep>('addDataStep');
  readonly optionStep = viewChild.required<CdkStep>('optionStep');
  readonly analysisStep = viewChild.required<CdkStep>('analysisStep');

  /**
   * Resolves only while the options step is the selected one, which is the
   * only time its validity gates anything.
   */
  readonly options = viewChild(OptionsComponent);

  selectedMethod$ = this.store.select(methodFeature.selectSelectedMethod);
  methodSelected$ = this.selectedMethod$.pipe(map((method) => method !== null));

  methodParameters$ = this.selectedMethod$.pipe(map((method) => method?.parameters));
  commonParameters$ = this.store.select(methodFeature.selectCommonParameters);
  parameters$ = combineLatest([this.methodParameters$, this.commonParameters$]).pipe(
    map(([method, common]) => [...(method || []), ...common])
  );

  datasetIds$ = this.store.select(datasetFeature.selectIds) as Observable<number[]>;
  datasets$ = this.store.select(datasetFeature.selectAll) as Observable<Dataset[]>;
  allSaved$: Observable<boolean> = this.store.select(datasetFeature.selectAllSaved);
  analysisId$: Observable<string> = this.store
    .select(analysisFeature.selectAnalysisId)
    .pipe(filter(isDefined));
  readonly analysisId = outputFromObservable(this.analysisId$);
  readonly analysisResult = outputFromObservable(
    this.store.select(analysisFeature.selectAnalysisResult)
  );
  reportRequired$ = this.commonParameters$.pipe(
    map(
      (parameters) =>
        (parameters?.find((parameter) => parameter.name === 'create_reports')?.value ||
          false) as boolean
    )
  );
  readonly reportsRequired = outputFromObservable(this.reportRequired$);
  readonly analysisReports = outputFromObservable(this.store.select(analysisFeature.selectReports));

  readonly seeResultAction = input<'link' | ((result: AnalysisResult) => void)>('link');
  readonly tourComponent = viewChild.required(TourComponent);
  editable = true;

  constructor() {
    const icons = this.icons;

    effect(
      () => this.tourComponent() && this.route.snapshot.queryParams['gsa-tour'] && this.tour.start()
    );
    icons.registerFontClassAlias('gsa', 'reactome-icon');
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.analysisId$
      .pipe(take(1))
      .subscribe((analysisId) => this.store.dispatch(analysisActions.cancel({ analysisId })));
  }

  addDataset() {
    this.store.dispatch(datasetActions.add());
  }

  private readonly stepIndex = signal(0);
  private readonly tourState = toSignal(this.tour.state$, { initialValue: 'off' as const });

  /**
   * Whether the guided tour can start now: from the first step only, where it
   * begins -- later steps keep the first one's panels in the page, hidden, so
   * the tour would point at something the reader cannot see, and going back to
   * it resets their datasets -- and not while it is already running.
   */
  readonly canStartTour = computed(() => this.stepIndex() === 0 && this.tourState() === 'off');

  startTour() {
    if (this.canStartTour()) this.tour.start();
  }

  async stepChange($event: StepperSelectionEvent, vm: any) {
    this.stepIndex.set($event.selectedIndex);
    switch ($event.selectedStep) {
      case this.setMethodStep():
        this.store.dispatch(datasetActions.reset());
        break;
      case this.addDataStep():
        this.initDatasetFormIfNone();
        break;
      case this.optionStep():
        this.store.dispatch(datasetActions.initAnnotationColumns());
        break;
      case this.analysisStep():
        this.store.dispatch(analysisActions.load(vm));
        this.editable = false;
        break;
    }
  }

  private initDatasetFormIfNone() {
    this.datasets$
      .pipe(take(1))
      .subscribe((datasets) => (datasets.length === 0 ? this.addDataset() : null));
  }

  async cancel() {
    if (this.stepper().selected === this.analysisStep()) {
      const dialogRef = this.dialog.open(CancelDialogComponent, {
        autoFocus: '#cancel',
        role: 'alertdialog',
      });
      const cancel = await firstValueFrom(dialogRef.afterClosed());
      if (cancel) {
        this.editable = true;
        this.later(() => this.stepper().previous());
        this.analysisId$
          .pipe(take(1))
          .subscribe((analysisId) => this.store.dispatch(analysisActions.cancel({ analysisId })));
      }
    }
  }

  restartAnalysis() {
    this.editable = true;
    this.later(() => (this.stepper().selected = this.setMethodStep()));
    this.analysisId$
      .pipe(take(1))
      .subscribe((analysisId) => this.store.dispatch(analysisActions.cancel({ analysisId })));
  }
}
