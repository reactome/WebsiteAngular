import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {MatIconModule} from '@angular/material/icon'
import NavOption from '../../types/nav-option';
import { mapNavOptions } from '../../utils/nav-options-mapper';

@Component({
  standalone: true,
  selector: 'app-navigation-bar',
  imports: [CommonModule, RouterModule, MatIconModule],
  templateUrl: './navigation-bar.component.html',
  styleUrl: './navigation-bar.component.scss'
})
export class NavigationBarComponent implements OnInit {
  windowWidth:number = window.innerWidth;
  navOptions: Record<string, NavOption> = {};
  activeDropdown: string | null = null;
  activeHamburgerMenu: boolean = false;

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

  @HostListener('window:resize', ['$event']) onResize(event: any) {
    this.windowWidth = window.innerWidth;
  }
}
