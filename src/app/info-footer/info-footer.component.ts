import { Component } from '@angular/core';
import NavOption from '../types/nav-option';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-info-footer',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIcon],
  templateUrl: './info-footer.component.html',
  styleUrl: './info-footer.component.scss'
})
export class InfoFooterComponent {
  navOptions: NavOption[] = [];

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = data.default;
    });
  }
}
