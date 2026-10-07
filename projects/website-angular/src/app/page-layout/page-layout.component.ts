import { Component, input } from '@angular/core';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-page-layout',
  imports: [SidebarComponent, BreadcrumbComponent],
  templateUrl: './page-layout.component.html',
  styleUrl: './page-layout.component.scss',
})
export class PageLayoutComponent {
  readonly showSidebar = input(true);
  readonly showBreadcrumb = input(true);
  // When true, the page projects its own sidebar content via the
  // `[pageSidebar]` ng-content slot instead of the default nav sidebar.
  readonly customSidebar = input(false);
}
