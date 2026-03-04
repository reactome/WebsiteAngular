import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, PLATFORM_ID, Inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

declare const SwaggerUIBundle: any;

@Component({
  selector: 'app-swagger-page',
  templateUrl: './swagger-page.component.html',
  styleUrl: './swagger-page.component.scss',
})
export class SwaggerPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('swaggerContainer', { static: true }) swaggerContainer!: ElementRef<HTMLDivElement>;

  private serviceName = '';
  private isBrowser: boolean;

  constructor(
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) platformId: Object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.serviceName = this.route.snapshot.data['serviceName'] || 'ContentService';
  }

  ngAfterViewInit() {
    if (!this.isBrowser) return;
    this.loadSwaggerUI();
  }

  private async loadSwaggerUI() {
    await this.loadCss('assets/swagger-ui/swagger-ui.css');
    await this.loadScript('assets/swagger-ui/swagger-ui-bundle.js');

    const url = `https://dev.reactome.org/${this.serviceName}/v3/api-docs`;
    SwaggerUIBundle({
      domNode: this.swaggerContainer.nativeElement,
      url,
    });
  }

  private loadScript(src: string): Promise<void> {
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  private loadCss(href: string): Promise<void> {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      document.head.appendChild(link);
    });
  }

  ngOnDestroy() {
    if (this.swaggerContainer?.nativeElement) {
      this.swaggerContainer.nativeElement.innerHTML = '';
    }
  }
}
