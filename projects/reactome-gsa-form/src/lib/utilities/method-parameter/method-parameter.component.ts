import { Component, input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { ParameterType } from '../../model/methods.model';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { FormControl, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { UntilDestroy } from '@ngneat/until-destroy';
import { Parameter } from '../../model/parameter.model';
import { LetDirective } from '@ngrx/component';
import { NgClass } from '@angular/common';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatError } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatInput } from '@angular/material/input';

@UntilDestroy()
@Component({
  selector: 'gsa-method-parameter',
  templateUrl: './method-parameter.component.html',
  styleUrls: ['./method-parameter.component.scss'],
  imports: [
    LetDirective,
    NgClass,
    MatTooltip,
    MatIcon,
    MatFormField,
    MatSelect,
    FormsModule,
    ReactiveFormsModule,
    MatOption,
    MatSlideToggle,
    MatInput,
    MatError,
  ],
})
export class MethodParameterComponent implements OnInit, OnChanges {
  private responsive = inject(BreakpointObserver);

  readonly parameter = input.required<Parameter>();
  readonly infoTooltip = input<boolean>(true);
  types = ParameterType;
  screenIsSmall$!: Observable<boolean>;

  control = new FormControl('', {
    validators: [],
    updateOn: 'blur',
  });

  @Output() parameterChange: Observable<Parameter> = this.control.valueChanges.pipe(
    map((value) => ({ ...this.parameter(), value }))
  );

  ngOnInit(): void {
    const parameter = this.parameter();
    if (parameter.type === 'email' || parameter.name.toLowerCase().includes('email')) {
      this.control.addValidators([Validators.email]);
    }

    this.control.setValue(parameter.value, { emitEvent: false });
    this.screenIsSmall$ = this.responsive
      .observe([Breakpoints.Small, Breakpoints.XSmall])
      .pipe(map((res) => res.matches));
  }

  ngOnChanges(changes: SimpleChanges): void {
    const paramChange = changes['parameter'];
    if (paramChange) this.control.setValue(this.parameter().value, { emitEvent: false });
  }
}
