import { Component, Input } from '@angular/core';
import { SidebarComponent } from "../sidebar/sidebar.component";
import { BreadcrumbComponent } from "../breadcrumb/breadcrumb.component";

@Component({
  selector: 'app-page-layout',
  imports: [SidebarComponent, BreadcrumbComponent],
  templateUrl: './page-layout.component.html',
  styleUrl: './page-layout.component.scss'
})
export class PageLayoutComponent {
  @Input() showSidebar = true;
  @Input() showBreadcrumb = true;
}
