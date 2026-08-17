import { Component, OnInit, inject } from '@angular/core';
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
} from '@angular/material/dialog';
import { InputCategory, InteractorToken } from '../model/interactor.model';
import { MatFormField, MatLabel, MatError, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatTabGroup, MatTab } from '@angular/material/tabs';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
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
  isDataLoading: boolean = false;
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

  onTabChange($event: MatTabChangeEvent) {
    this.tabId = $event.tab.ariaLabelledby;
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

  submit() {
    this.isDataLoading = true;
    const userInput = this.getInputs();
    if (userInput) {
      this.interactorService
        .getInteractorsFromToken(this.name.value!, userInput.url!, userInput.content!, this.cy)
        .subscribe((result) => {
          this.interactorService.addInteractorOccurrenceNode(
            result.interactors,
            this.cy,
            result.interactors.resource
          );
          this.token = result.token;
          this.isDataLoading = false;
          this.dialogRef.close();
        });
    }
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
