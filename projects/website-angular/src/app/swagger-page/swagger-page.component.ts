import {
  Component,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  PLATFORM_ID,
  inject,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { withReportCheck } from './analysis-description';

/** The Swagger UI bundle's global, loaded as a script: the options this page gives it. */
declare const SwaggerUIBundle: (options: {
  domNode: HTMLElement;
  url?: string;
  spec?: unknown;
  deepLinking: boolean;
}) => unknown;

/**
 * Each service's description, under its own root. The content service's is the
 * one generated from the shared contract (spec 016, T028), which says what each
 * answer holds; the analysis service's is still its own.
 */
const DESCRIPTIONS: Record<string, string> = {
  ContentService: 'ContentService/openapi.json',
  AnalysisService: 'AnalysisService/v3/api-docs',
};

@Component({
  selector: 'app-swagger-page',
  templateUrl: './swagger-page.component.html',
  styleUrl: './swagger-page.component.scss',
})
export class SwaggerPageComponent implements AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);

  readonly swaggerContainer = viewChild.required<ElementRef<HTMLDivElement>>('swaggerContainer');

  private serviceName = '';
  private isBrowser: boolean;

  constructor() {
    const platformId = inject(PLATFORM_ID);

    this.isBrowser = isPlatformBrowser(platformId);
    const name: unknown = this.route.snapshot.data['serviceName'];
    this.serviceName = typeof name === 'string' && name !== '' ? name : 'ContentService';
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
    const url = `${window.location.origin}/${DESCRIPTIONS[this.serviceName] ?? `${this.serviceName}/v3/api-docs`}`;
    // The analysis service's description is Java's, written before a report
    // needed a person's check: read here and given with the report amended
    // (spec 031, T026). Where it cannot be read, Swagger UI is given the
    // address, and shows its own failure.
    const spec = this.serviceName === 'AnalysisService' ? await this.amended(url) : undefined;
    SwaggerUIBundle({
      domNode: this.swaggerContainer().nativeElement,
      ...(spec === undefined ? { url } : { spec }),
      // Follows `#/{tag}/{operationId}` in the address, so a link to one
      // operation opens it rather than the top of a 98-operation page.
      deepLinking: true,
    });
  }

  /** The analysis service's description with the report's check, or undefined. */
  private async amended(url: string): Promise<unknown> {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return undefined;
      return withReportCheck(await response.json());
    } catch {
      return undefined;
    }
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
    this.swaggerContainer().nativeElement.innerHTML = '';
  }
}
