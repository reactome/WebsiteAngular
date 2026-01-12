import { Component } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [NgIf],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss'
})
export class CiteUsComponent {
  showText: boolean = false;
  showModal: boolean = false;
}
