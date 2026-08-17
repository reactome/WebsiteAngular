import { Component, input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import {Observable} from 'rxjs';
import {PDataset} from '../../../state/dataset/dataset.state';
import {Store} from '@ngrx/store';
import {AnalysisGroups, datasetFeature,} from '../../../state/dataset/dataset.selector';
import {datasetActions} from '../../../state/dataset/dataset.actions';
import {Covariate} from "../../../model/dataset.model";
import { LetDirective } from '@ngrx/component';
import { TourAnchorMatMenuDirective } from 'ngx-ui-tour-md-menu';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { KeyValuePipe } from '@angular/common';

@Component({
    selector: 'gsa-statistical-design',
    templateUrl: './statistical-design.component.html',
    styleUrls: ['./statistical-design.component.scss'],
    imports: [LetDirective, FormsModule, ReactiveFormsModule, TourAnchorMatMenuDirective, MatIcon, MatTooltip, MatFormField, MatSelect, MatOption, MatCheckbox, KeyValuePipe]
})
export class StatisticalDesignComponent implements OnInit {
    private formBuilder = inject(FormBuilder);
    store = inject(Store);

    readonly datasetId = input.required<number>();
    dataset$!: Observable<PDataset | undefined>;
    statisticalDesignStep: FormGroup;
    analysisGroups$!: Observable<AnalysisGroups>;
    covariates$!: Observable<Covariate[]>;

    someSelected$!: Observable<boolean>;
    allSelected$!: Observable<boolean>;

    constructor() {
        this.statisticalDesignStep = this.formBuilder.group({
            address: ['', Validators.required],
        });
    }

    ngOnInit(): void {
        this.dataset$ = this.store.select(datasetFeature.selectDataset(this.datasetId()),);
        this.analysisGroups$ = this.store.select(datasetFeature.selectAnalysisGroups(this.datasetId()),);
        this.covariates$ = this.store.select(datasetFeature.selectCovariates(this.datasetId()));
        this.someSelected$ = this.store.select(datasetFeature.selectCovariancesSomeSelected(this.datasetId()));
        this.allSelected$ = this.store.select(datasetFeature.selectCovariancesAllSelected(this.datasetId()));
    }


    changeAllCovariates(value: boolean) {
        this.store.dispatch(
            datasetActions.setCovariatesValue({id: this.datasetId(), value: value})
        );
    }

    comparisonGroup2Values(groups: string[], group1: string) {
        if (!groups) return [];
        return groups.filter((group) => group !== group1);
    }

    changeComparisonFactor(value: string) {
        this.store.dispatch(
            datasetActions.setAnalysisGroup({
                group: value,
                id: this.datasetId()
            })
        );
    }

    changeGroup1(group: string) {
        this.store.dispatch(datasetActions.setComparisonGroup1({group, id: this.datasetId(),}));
    }

    changeGroup2(group: string) {
        this.store.dispatch(datasetActions.setComparisonGroup2({group, id: this.datasetId(),}));
    }

    setCovariance(value: boolean, group: string) {
        this.store.dispatch(datasetActions.setCovariateValue({
            group,
            value,
            id: this.datasetId(),
        }));
    }
}
