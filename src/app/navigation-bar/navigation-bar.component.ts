import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface NavLink {
  label: string;
  link: string;
}

interface NavOption {
  label: string;
  link: string;
  icon?: string;
  'dropdown-links'?: NavLink[];
}

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
    import('./nav-options.json').then((data) => {
      this.navOptions = data.default;
    });
  }

  toggleDropdown(label: string) {
    this.activeDropdown = this.activeDropdown === label ? null : label;
  }

  closeDropdown() {
    this.activeDropdown = null;
  }
}
