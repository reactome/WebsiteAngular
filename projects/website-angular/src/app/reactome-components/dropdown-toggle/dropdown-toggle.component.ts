import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-dropdown-toggle',
  imports: [],
  templateUrl: './dropdown-toggle.component.html',
  styleUrl: './dropdown-toggle.component.scss',
})
export class DropdownToggleComponent {
  readonly name = input<string>('');
  readonly toggleEvent = output<boolean>();

  open = true;

  toggle() {
    this.open = !this.open;
    this.toggleEvent.emit(this.open);
  }
}
