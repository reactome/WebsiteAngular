import { Component } from '@angular/core';
import { DropdownComponent } from '../../reactome-components/dropdown/dropdown.component';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';

@Component({
  selector: 'app-logo-page',
  imports: [DropdownComponent, PageLayoutComponent],
  templateUrl: './logo-page.component.html',
  styleUrl: './logo-page.component.scss',
})
export class LogoPageComponent {}
