import { Component, input, model } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';

@Component({
  selector: 'gsa-dropdown',
  templateUrl: './dropdown.component.html',
  styleUrls: ['./dropdown.component.scss'],
  imports: [MatFormField, MatSelect, MatOption],
})
export class DropdownComponent {
  readonly options = input.required<any[]>();
  readonly placeholder = input<string>('');

  readonly value = model.required<string>();
  readonly disabled = input<boolean>(false);

  constructor() {}
}
