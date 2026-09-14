import {
  Component,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

declare const SwaggerUIBundle: any;

@Component({
  selector: 'app-swagger-page',
  templateUrl: './swagger-page.component.html',
  styleUrl: './swagger-page.component.scss',
})
export class SwaggerPageComponent implements AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);

  @ViewChild('swaggerContainer', { static: true }) swaggerContainer!: ElementRef<HTMLDivElement>;

  private serviceName = '';
  private isBrowser: boolean;

  constructor() {
    const platformId = inject(PLATFORM_ID);

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

    // The spec comes from the origin we are served from, and from nowhere else.
    // Every public host (beta, release, reactome.org, the curator site)
    // reverse-proxies its own /AnalysisService and /ContentService, so
    // same-origin always resolves -- and where it does not, a visible failure is
    // the right outcome. Showing someone another deployment's API docs while
    // they believe they are reading this one's is worse than showing nothing.
    //
    // It also sidesteps a real trap: dev.reactome.org sits behind
    // mod_auth_openidc, which 302s /AnalysisService/v3/api-docs to Keycloak, and
    // that login response carries no Access-Control-Allow-Origin, so the browser
    // blocks the cross-origin XHR even for a logged-in user.
    //
    // ngAfterViewInit returns early off-browser, so window is always defined by
    // the time this runs.
    const url = `${window.location.origin}/${this.serviceName}/v3/api-docs`;
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
