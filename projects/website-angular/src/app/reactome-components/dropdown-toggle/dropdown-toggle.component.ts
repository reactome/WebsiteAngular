import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-dropdown-toggle',
  imports: [],
  templateUrl: './dropdown-toggle.component.html',
  styleUrl: './dropdown-toggle.component.scss',
})
export class DropdownToggleComponent {
  @Input() name: string = '';
  @Output() toggleEvent = new EventEmitter<boolean>();

  open = true;

  toggle() {
    this.open = !this.open;
    this.toggleEvent.emit(this.open);
  }
}
