import { CommonModule } from '@angular/common';
import { Component, Input,  } from '@angular/core';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-dropdown',
  imports: [CommonModule, MatIcon],
  templateUrl: './dropdown.component.html',
  styleUrl: './dropdown.component.scss'
})
export class DropdownComponent {
  @Input() buttonStyle: string = '';
  @Input() menuStyle: string = '';
  @Input() buttonLabel: string = ''
  @Input() buttonIcon: string = '';

  menuDown: boolean = false;

  viewMenu() {
    this.menuDown = true;
  }

  hideMenu() {
    this.menuDown = false;
  }

  toggleMenu() {
    this.menuDown = !this.menuDown;
  }
}
