import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import NavOption from '../types/nav-option';

@Component({
  standalone: true,
  selector: 'app-navigation-bar',
  imports: [CommonModule, RouterModule],
  templateUrl: './navigation-bar.component.html',
  styleUrl: './navigation-bar.component.scss'
})
export class NavigationBarComponent implements OnInit {
  navOptions: NavOption[] = [];
  activeDropdown: string | null = null;

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../config/nav-options.json').then((data) => {
      this.navOptions = data.default;
    });
  }

  toggleDropdown(label: string) {
    this.activeDropdown = this.activeDropdown === label ? null : label;
  }

  showDropdown(label: string) {
    const option = this.navOptions.find(opt => opt.label === label);
    if (option && option['dropdown-links'] && option['dropdown-links'].length > 0) {
      this.activeDropdown = label;
    }
  }

  hideDropdown() {
    this.activeDropdown = null;
  }

  closeDropdown() {
    this.activeDropdown = null;
  }
}
