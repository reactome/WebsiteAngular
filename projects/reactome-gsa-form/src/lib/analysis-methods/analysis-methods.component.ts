import { Component, effect, OnInit, inject } from '@angular/core';
import {UntilDestroy} from "@ngneat/until-destroy";
import {Store} from "@ngrx/store";
import {Observable} from "rxjs";
import {Method} from "../state/method/method.state";
import {methodFeature} from "../state/method/method.selector";
import {methodActions} from "../state/method/method.action";
import {ConfigProvider, REACTOME_GSA_CONFIG} from "../config/gsa-config";
import { LetDirective } from '@ngrx/component';
import { MatAccordion } from '@angular/material/expansion';
import { MethodComponent } from './method/method.component';
import { TourAnchorMatMenuDirective } from 'ngx-ui-tour-md-menu';

@UntilDestroy()
@Component({
    selector: 'gsa-analysis-methods',
    templateUrl: './analysis-methods.component.html',
    styleUrls: ['./analysis-methods.component.scss'],
    imports: [LetDirective, MatAccordion, MethodComponent, TourAnchorMatMenuDirective]
})
export class AnalysisMethodsComponent implements OnInit {
  private store = inject(Store);


  methodNames$: Observable<string[]> = this.store.select(methodFeature.selectIds) as Observable<string[]>;
  methods$: Observable<Method[]> = this.store.select(methodFeature.selectAll);

  ngOnInit(): void {
    this.store.dispatch(methodActions.load());
  }
}

