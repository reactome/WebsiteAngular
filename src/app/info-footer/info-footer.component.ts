import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIcon } from "@angular/material/icon";
import { mapNavOptions } from '../../utils/nav-options-mapper';
import { NavOption } from '../../types/link';

@Component({
  selector: 'app-info-footer',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIcon],
  templateUrl: './info-footer.component.html',
  styleUrl: './info-footer.component.scss'
})
export class InfoFooterComponent {
  navOptions: Record<string, NavOption> = {};

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  // Preserve original insertion order for keyvalue pipe
  preserveOrder = () => 0;
}
