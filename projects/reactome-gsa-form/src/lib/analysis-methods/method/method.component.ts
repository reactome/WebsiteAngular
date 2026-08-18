import { Component, input, OnInit, inject } from '@angular/core';
import { ScrollService } from '../../services/scroll.service';
import { Method } from '../../state/method/method.state';
import { Store } from '@ngrx/store';
import { methodActions } from '../../state/method/method.action';
import { filter, map, Observable } from 'rxjs';
import { methodFeature } from '../../state/method/method.selector';
import { isDefined } from '../../utilities/utils';
import { Parameter } from '../../model/parameter.model';
import { LetDirective } from '@ngrx/component';
import {
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle,
  MatExpansionPanelDescription,
} from '@angular/material/expansion';
import { NgClass } from '@angular/common';
import { MethodParameterComponent } from '../../utilities/method-parameter/method-parameter.component';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'gsa-method',
  templateUrl: './method.component.html',
  styleUrls: ['./method.component.scss'],
  imports: [
    LetDirective,
    MatExpansionPanel,
    NgClass,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatExpansionPanelDescription,
    MethodParameterComponent,
    MatButton,
  ],
})
export class MethodComponent implements OnInit {
  private scrollService = inject(ScrollService);
  private store = inject(Store);

  readonly methodName = input.required<string>();
  selected$ = this.store
    .select(methodFeature.selectSelectedMethodName)
    .pipe(map((name) => name === this.methodName()));
  method$!: Observable<Method>;
  parameters$!: Observable<Parameter[]>;

  ngOnInit(): void {
    this.method$ = this.store
      .select(methodFeature.selectMethod(this.methodName()))
      .pipe(filter(isDefined));
    this.parameters$ = this.method$.pipe(
      map((method) => Object.values(method.parameters).filter((p) => p.scope === 'analysis'))
    );
  }

  selectMethod() {
    this.store.dispatch(methodActions.select({ methodName: this.methodName() }));
  }

  setToDefault(parameters: Parameter[]) {
    parameters = parameters.map((p) => ({ ...p, value: p.default }));
    this.store.dispatch(methodActions.updateSelectedParams({ parameters }));
  }

  updateScroll() {
    setTimeout(() => this.scrollService.triggerResize(), 120);
  }

  updateParam(param: Parameter) {
    this.store.dispatch(methodActions.updateSelectedParam({ param }));
  }
}
