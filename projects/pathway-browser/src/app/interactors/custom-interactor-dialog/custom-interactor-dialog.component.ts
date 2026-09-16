import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { merge } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTabChangeEvent } from '@angular/material/tabs';
import { MatRadioChange, MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { InteractorService } from '../services/interactor.service';
import cytoscape from 'cytoscape';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
  // Without this, `mat-dialog-close` is an inert attribute rather than a
  // directive: the button labelled Close did nothing at all, and the only ways
  // out were Escape and the backdrop, neither of which the dialog mentions.
  // Reported as "it opens but you can't close it", and that is exactly what it
  // was -- measured on beta, the dialog count stayed at 1 through the click.
  MatDialogClose,
} from '@angular/material/dialog';
import { InputCategory, InteractorToken } from '../model/interactor.model';
import { parseCustomInteractions } from '../custom-interactor-parse';
import { MatFormField, MatLabel, MatError, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatTabGroup, MatTab } from '@angular/material/tabs';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
// v21 of this package dropped MaterialFileInputModule and went standalone;
// only <ngx-mat-file-input> is used here, which is FileInputComponent.
import { FileInputComponent } from 'ngx-custom-material-file-input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'cr-custom-interactor-dialog',
  templateUrl: './custom-interactor-dialog.component.html',
  styleUrls: ['./custom-interactor-dialog.component.scss'],
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatFormField,
    MatLabel,
    MatInput,
    MatError,
    MatHint,
    ReactiveFormsModule,
    MatTabGroup,
    MatTab,
    MatRadioGroup,
    MatRadioButton,
    MatButton,
    MatCheckbox,
    MatIconButton,
    MatDialogClose,
    MatTooltip,
    MatIcon,
    FileInputComponent,
    MatProgressSpinner,
  ],
})
export class CustomInteractorDialogComponent implements OnInit {
  private interactorService = inject(InteractorService);
  private dialogRef = inject<MatDialogRef<CustomInteractorDialogComponent>>(MatDialogRef);
  private fb = inject(FormBuilder);
  data = inject<{
    cy: cytoscape.Core;
  }>(MAT_DIALOG_DATA);

  cy!: cytoscape.Core;
  name = new FormControl('', [
    Validators.required,
    Validators.pattern(/^[a-zA-Z_]+[a-zA-Z0-9_]*$/),
  ]);
  resourceForm!: FormGroup;
  errorMessage = '';
  tabId = 'data'; // Default value
  selectedValue = 'form'; // Default value
  /**
   * Signals, not fields.
   *
   * This app is zoneless, so a value set from an HTTP callback changes nothing
   * on screen: the request came back 400, the handler ran, and the dialog went
   * on showing a spinner with no message -- indistinguishable from the hang this
   * was meant to fix. Measured on beta before the change.
   */
  readonly isDataLoading = signal(false);
  /** Why the last attempt was refused, in the service's own words. */
  readonly uploadError = signal('');
  /** What the parser accepted but wants the reader to know about. */
  readonly warnings = signal<string[]>([]);
  /** Whether the format note is expanded. */
  readonly showHelp = signal(false);
  token?: InteractorToken;
  items = [
    { name: 'form', content: 'File' },
    { name: 'content', content: 'Copy & Paste' },
    { name: 'url', content: 'URL' },
  ];

  constructor() {
    this.resourceForm = this.fb.group(
      {
        selectedValue: [''],
        form: [''], // file uploader
        content: [''],
        url: [''],
        psicquicUrl: [''],
      },
      { validators: this.formGroupValidator }
    );

    merge(this.name.statusChanges, this.name.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateErrorMessage());
  }

  ngOnInit() {
    this.cy = this.data.cy;
  }

  formGroupValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const fileValue = control.value.form;
    const contentValue = control.value.content;
    const urlValue = control.value.url;
    const psicquicUrlValue = control.value.psicquicUrl;
    if (fileValue || contentValue || urlValue || psicquicUrlValue) {
      return null;
    } else {
      return { invalid: true };
    }
  };

  updateErrorMessage() {
    if (this.name.hasError('required')) {
      this.errorMessage = 'You must enter a name';
    } else if (this.name.hasError('pattern')) {
      this.errorMessage = 'Name can only contain letters';
    } else {
      this.errorMessage = '';
    }
  }

  /**
   * Which tab is in force, by position rather than by `ariaLabelledby`.
   *
   * That attribute is Material's to manage, and getting it wrong here does not
   * fail loudly -- it silently posts a PSICQUIC service URL to the endpoint that
   * parses pasted tables, which can only be refused.
   */
  onTabChange($event: MatTabChangeEvent) {
    this.tabId = $event.index === 1 ? 'psicquic' : 'data';
    this.uploadError.set('');
  }

  onItemChange($event: MatRadioChange) {
    this.selectedValue = $event.value;
  }

  onFileChange($event: Event) {
    // const inputElement = $event.target as HTMLInputElement;
    // if (inputElement.files && inputElement.files.length) {
    //   const file = inputElement.files[0]; // Single file upload
    //   this.resourceForm.patchValue({form: file});
    // }
  }

  /**
   * Whether a file or a paste is read here or sent to the service.
   *
   * Off by default, so a reader's own data stays on their machine. It is offered
   * at all because the token the service returns is what makes a custom overlay
   * survive a reload and open for a colleague: parse locally and the link is
   * yours alone. That is a real thing to give up, so it is a choice rather than
   * a decision made for them.
   */
  readonly shareByLink = signal(false);

  /** Local reading applies to a file or a paste; the others need the service. */
  canParseHere(): boolean {
    return this.tabId === 'data' && this.selectedValue !== 'url';
  }

  submit() {
    if (this.name.invalid) {
      this.name.markAsTouched();
      this.updateErrorMessage();
      return;
    }

    this.uploadError.set('');
    this.warnings.set([]);

    if (this.canParseHere() && !this.shareByLink()) {
      void this.submitHere();
      return;
    }

    this.isDataLoading.set(true);
    const userInput = this.getInputs();
    if (!userInput) {
      this.isDataLoading.set(false);
      return;
    }

    this.interactorService
      .getInteractorsFromToken(this.name.value!, userInput.url!, userInput.content!, this.cy)
      .subscribe({
        next: (result) => {
          this.interactorService.addInteractorOccurrenceNode(
            result.interactors,
            this.cy,
            result.interactors.resource
          );
          this.token = result.token;
          this.warnings.set(result.token.warningMessages ?? []);
          this.isDataLoading.set(false);
          this.dialogRef.close();
        },
        // Without this the spinner span forever and the dialog stayed open with
        // nothing said: every rejection the service makes -- and it rejects
        // freely, see the format note in the template -- looked like the dialog
        // being stuck.
        error: (error: unknown) => {
          this.isDataLoading.set(false);
          this.uploadError.set(describeUploadFailure(error));
        },
      });
  }

  /**
   * Draw it without asking anyone.
   *
   * No request is made, so there is nothing to fail on the network and nothing
   * stored anywhere. The resource is held in memory for as long as the page is
   * open, which is exactly as long as it can be drawn.
   */
  private async submitHere(): Promise<void> {
    this.isDataLoading.set(true);
    try {
      const text = await this.readInput();
      const name = this.name.value!;
      const parsed = parseCustomInteractions(text, name);

      if (parsed.error) {
        this.uploadError.set(parsed.error);
        return;
      }

      this.warnings.set(parsed.warnings);
      this.interactorService.rememberLocalResource(name, parsed.interactors);
      this.interactorService.addInteractorOccurrenceNode(parsed.interactors, this.cy, name);
      this.token = {
        summary: {
          // No token: there is nothing on a server to point at. The resource is
          // named by the reader and lives in this page.
          token: '',
          name,
          fileName: name,
          interactors: parsed.interactors.entities.length,
          interactions: parsed.interactors.entities.reduce(
            (total, entity) => total + (entity.interactors?.length ?? 0),
            0
          ),
        },
        warningMessages: parsed.warnings,
      };
      this.dialogRef.close();
    } catch {
      this.uploadError.set('That file could not be read.');
    } finally {
      this.isDataLoading.set(false);
    }
  }

  /** The text to read, whether it was typed or chosen from disk. */
  private async readInput(): Promise<string> {
    const value = this.resourceForm.value[this.selectedValue];
    if (typeof value === 'string') return value;
    // ngx-mat-file-input hands over a FileInput holding the chosen files.
    const file = (value as { files?: File[] } | null)?.files?.[0];
    if (file) return file.text();
    return '';
  }

  private getInputs(): InputCategory {
    const input = new InputCategory();
    const formValue = this.resourceForm.value;

    if (this.tabId === 'data') {
      input.url = this.interactorService.UPLOAD_URL + this.selectedValue;
      input.content = formValue[this.selectedValue];
      if (this.selectedValue === this.items[0].name) {
        // Prepare formdata when file is uploaded
        input.content = this.prepareFormData(formValue.form);
      }
    }

    if (this.tabId === 'psicquic') {
      input.url = this.interactorService.UPLOAD_PSICQUIC_URL;
      input.content = formValue.psicquicUrl;
    }
    return input;
  }

  private prepareFormData(formControl: string | Blob): FormData {
    const formData = new FormData();
    formData.append('file', formControl);
    return formData;
  }
}

/**
 * The service's reason, rather than "something went wrong".
 *
 * It answers a refusal with `{"messages":[...]}` -- measured against beta on
 * 2026-09-15: "Missing header. Cannot parse your file properly" for a table it
 * cannot read, and "Line 2 does not have mandatory field(s): [ID_A, ID_B]" for
 * one whose rows do not match its header. Those say exactly what to fix, so they
 * are worth more to the reader than anything this code could write.
 */
function describeUploadFailure(error: unknown): string {
  const body = (error as { error?: { messages?: unknown } } | null)?.error;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length > 0) return messages.map(String).join(' ');

  const status = (error as { status?: number } | null)?.status;
  if (status === 0) return 'Could not reach the service. Check your connection and try again.';
  return 'The service could not accept that. Check the format note below and try again.';
}
