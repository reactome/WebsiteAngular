import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, PLATFORM_ID, Inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { APP_CONFIG } from '../../config/config';

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
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.serviceName = this.route.snapshot.data['serviceName'] || 'ContentService';
  }

  ngAfterViewInit() {
    if (!this.isBrowser) return;
    void this.loadSwaggerUI().catch((error) =>
      console.error('Could not load the Swagger UI', error)
    );
  }

  private async loadSwaggerUI() {
    await this.loadCss('assets/swagger-ui/swagger-ui.css');
    await this.loadScript('assets/swagger-ui/swagger-ui-bundle.js');

    // Fetch the OpenAPI spec from the same origin we're served from, not
    // APP_CONFIG.swaggerSpecBaseUrl. dev.reactome.org sits behind
    // mod_auth_openidc which 302s /AnalysisService/v3/api-docs to Keycloak;
    // that login response carries no Access-Control-Allow-Origin, so the
    // browser blocks the cross-origin XHR even after the user has logged
    // in. Every public host (beta, release, reactome.org) reverse-proxies
    // its own /AnalysisService and /ContentService, so same-origin works.
    const baseUrl =
      typeof window !== 'undefined' ? window.location.origin : APP_CONFIG.swaggerSpecBaseUrl;
    const url = `${baseUrl}/${this.serviceName}/v3/api-docs`;
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
