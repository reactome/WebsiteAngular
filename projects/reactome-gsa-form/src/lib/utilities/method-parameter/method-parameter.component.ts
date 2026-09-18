import {
  Component,
  DestroyRef,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

  /** Emitted whenever this parameter's value becomes valid or invalid. */
  readonly validityChange = output<boolean>();

  types = ParameterType;
  screenIsSmall$!: Observable<boolean>;

  /**
   * The control's validity as a signal. `control.invalid` is a plain property,
   * so a template reading it directly never re-renders in this zoneless app.
   */
  readonly invalid = signal(false);

  /**
   * The type the field is *rendered* as. The server sends the e-mail parameter
   * as `string`, so switching on `parameter().type` would render it as a plain
   * text box and leave the e-mail branch — and its error message — unreachable.
   * The validator and the template must agree on what counts as an e-mail field.
   */
  readonly effectiveType = computed(() => {
    const parameter = this.parameter();
    return isEmailParameter(parameter) ? ParameterType.email : parameter.type;
  });

  private readonly destroyRef = inject(DestroyRef);

  control = new FormControl('', {
    validators: [],
    updateOn: 'blur',
  });

  /**
   * Validates what is in the box right now, without touching `control`.
   *
   * `control` updates on blur, which is too late to gate a button: clicking
   * Continue blurs the input, so the blur and the click race, and in a zoneless
   * app the re-render loses. This probe runs on every keystroke so the field is
   * already marked — and Continue already disabled — before any click lands.
   */
  private readonly liveProbe = new FormControl('', Validators.email);

  @Output() parameterChange: Observable<Parameter> = this.control.valueChanges.pipe(
    map((value) => ({ ...this.parameter(), value }))
  );

  onLiveInput(event: Event): void {
    this.liveProbe.setValue((event.target as HTMLInputElement).value);
    this.setValidity(this.liveProbe.valid);
  }

  ngOnInit(): void {
    const parameter = this.parameter();
    if (isEmailParameter(parameter)) {
      this.control.addValidators([Validators.email]);
    }

    this.control.setValue(parameter.value, { emitEvent: false });
    this.publishValidity();

    this.control.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.publishValidity());

    this.screenIsSmall$ = this.responsive
      .observe([Breakpoints.Small, Breakpoints.XSmall])
      .pipe(map((res) => res.matches));
  }

  ngOnChanges(changes: SimpleChanges): void {
    const paramChange = changes['parameter'];
    if (!paramChange) return;
    this.control.setValue(this.parameter().value, { emitEvent: false });
    // setValue with emitEvent false does not run statusChanges, so a value
    // restored from the store has to be re-checked by hand.
    this.publishValidity();
  }

  private publishValidity(): void {
    this.setValidity(this.control.valid);
  }

  /**
   * Only emits on an actual change. The parent keeps this in a signal, and
   * lifecycle hooks run during change detection, so an unconditional emit on
   * init would write to that signal mid-render for every parameter on screen.
   */
  private setValidity(valid: boolean): void {
    if (this.invalid() === !valid) return;
    this.invalid.set(!valid);
    this.validityChange.emit(valid);
  }
}

/**
 * The single predicate for "this parameter holds an e-mail address", used by
 * both the validator and the render branch so they cannot disagree.
 */
export function isEmailParameter(parameter: Parameter): boolean {
  return parameter.type === ParameterType.email || parameter.name.toLowerCase().includes('email');
}
