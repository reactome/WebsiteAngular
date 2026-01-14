import { Component } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [NgIf, MatIcon],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss'
})
export class CiteUsComponent {
  showText: boolean = false;
  showModal: boolean = false;
}
