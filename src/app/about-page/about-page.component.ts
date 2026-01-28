import { Component } from '@angular/core';
import { PageLayoutComponent } from '../page-layout/page-layout.component';

@Component({
  selector: 'app-about-page',
  imports: [PageLayoutComponent],
  templateUrl: './about-page.component.html',
  styleUrl: './about-page.component.scss'
})
export class AboutPageComponent {
    page: any | null = null;
    renderedContent: string = '';
    loading = true;
    error: string | null = null;
}
