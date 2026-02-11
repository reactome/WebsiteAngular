import { Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { mapNavOptions } from '../../utils/nav-options-mapper';
import { NavLink, NavOption } from '../../types/link';
import { DarkService } from '../../../../pathway-browser/src/app/services/dark.service';

@Component({
  standalone: true,
  selector: 'app-navigation-bar',
  imports: [CommonModule, RouterModule, MatIconModule, MatSlideToggleModule, FormsModule],
  templateUrl: './navigation-bar.component.html',
  styleUrl: './navigation-bar.component.scss'
})
export class NavigationBarComponent implements OnInit {
  windowWidth:number = window.innerWidth;
  navOptions: Record<string, NavOption> = {};
  activeDropdown: string | null = null;
  activeHamburgerMenu: boolean = false;
  public dark: DarkService = inject(DarkService);

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  toggleHamburgerMenu() {
    this.activeHamburgerMenu = !this.activeHamburgerMenu;
  }

  toggleDropdown(label: string) {
    this.activeDropdown = this.activeDropdown === label ? null : label;
  }

  showDropdown(label: string) {
    const option = this.navOptions[label];
    if (option && option.dropdownLinks && Object.keys(option.dropdownLinks).length > 0) {
      this.activeDropdown = label;
    }
  }

  showHamburgerDropdown(label: string) {
    this.activeHamburgerMenu = true;
  }

  hideDropdown() {
    this.activeDropdown = null;
  }

  closeDropdown() {
    this.activeDropdown = null;
  }

  closeHamburgerMenu() {
    this.activeHamburgerMenu = false;
  }

  // Preserve original insertion order for keyvalue pipe
  preserveOrder = () => 0;

  asNavOption(value: unknown): NavOption | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return value as NavOption;
  }

  asNavLink(value: unknown): NavLink | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return value as NavLink;
  }

  @HostListener('window:resize', ['$event']) onResize(event: any) {
    this.windowWidth = window.innerWidth;
  }
}
