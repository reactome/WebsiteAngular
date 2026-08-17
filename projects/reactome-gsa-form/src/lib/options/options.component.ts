import { Component, inject } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {Store} from "@ngrx/store";
import {methodActions} from "../state/method/method.action";
import {Parameter} from "../model/parameter.model";
import {Observable} from "rxjs";
import {methodFeature} from "../state/method/method.selector";

@Component({
    selector: 'gsa-options',
    templateUrl: './options.component.html',
    styleUrls: ['./options.component.scss'],
    standalone: false
})
export class OptionsComponent {
  private formBuilder = inject(FormBuilder);
  store = inject(Store);

  analysisOptionsStep: FormGroup;
  parameters$: Observable<Parameter[]> = this.store.select(methodFeature.selectCommonParameters);

  constructor() {
    this.analysisOptionsStep = this.formBuilder.group({
      name: ['', Validators.required]
    });
  }


  updateParam(param: Parameter) {
    this.store.dispatch(methodActions.updateCommonParam({param}));
  }

}
