import { computed, Component, OnInit, inject, signal, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { StatsService } from '../../services/stats.service';
import {
  TOC_ITEMS,
  SERVICE_CARDS,
  GRAPH_DB_DOWNLOADS,
  MYSQL_DOWNLOADS,
  MAPPING_DATABASES,
  MAPPING_CATEGORIES,
  PE_MAPPING_CATEGORIES,
  OTHER_MAPPINGS,
  PATHWAY_DOWNLOADS,
  DIAGRAM_DOWNLOADS,
  GENE_ONTOLOGY_DOWNLOADS,
  SYSTEMS_BIOLOGY_DOWNLOADS,
  GENE_SET_DOWNLOADS,
  ONTOLOGY_DOWNLOADS,
  PPI_MITAB_DOWNLOADS,
  PPI_TAB_DOWNLOADS,
  FUNCTIONAL_INTERACTIONS,
  CURATOR_TOOL,
  TEXTBOOK,
  INFO_PANELS,
  buildUrl,
  buildMappingUrl,
} from './download-data.data';

@Component({
  selector: 'app-download-data',
  imports: [PageLayoutComponent],
  templateUrl: './download-data.component.html',
  styleUrl: './download-data.component.scss',
})
export class DownloadDataComponent implements OnInit, OnDestroy {
  private stats = inject(StatsService);
  private platformId = inject(PLATFORM_ID);

  version = '';
  baseUrl = '';

  // Data
  readonly tocItems = TOC_ITEMS;
  readonly serviceCards = SERVICE_CARDS;
  readonly graphDbDownloads = GRAPH_DB_DOWNLOADS;
  readonly mysqlDownloads = MYSQL_DOWNLOADS;
  readonly mappingDatabases = MAPPING_DATABASES;
  readonly mappingCategories = MAPPING_CATEGORIES;
  readonly peMappingCategories = PE_MAPPING_CATEGORIES;
  readonly otherMappings = OTHER_MAPPINGS;
  readonly pathwayDownloads = PATHWAY_DOWNLOADS;
  readonly diagramDownloads = DIAGRAM_DOWNLOADS;
  readonly geneOntologyDownloads = GENE_ONTOLOGY_DOWNLOADS;
  readonly systemsBiologyDownloads = SYSTEMS_BIOLOGY_DOWNLOADS;
  readonly geneSetDownloads = GENE_SET_DOWNLOADS;
  readonly ontologyDownloads = ONTOLOGY_DOWNLOADS;
  readonly ppiMitabDownloads = PPI_MITAB_DOWNLOADS;
  readonly ppiTabDownloads = PPI_TAB_DOWNLOADS;
  readonly functionalInteractions = FUNCTIONAL_INTERACTIONS;
  readonly curatorTool = CURATOR_TOOL;
  readonly textbook = TEXTBOOK;
  readonly infoPanels = INFO_PANELS;

  // Track expanded info panels
  expandedPanels: Record<string, boolean> = {};

  // Active TOC section
  // A signal because it is set from an IntersectionObserver, which Angular
  // cannot observe -- with zones off, a plain field would leave the table of
  // contents never highlighting the section being read.
  readonly activeTocId = signal('');

  private observer?: IntersectionObserver;

  ngOnInit() {
    // Angular ignores whatever ngOnInit returns, so an async one hides its own
    // failures; the page would just keep its default version and base URL.
    void this.load().catch((error) => console.error('Could not load download metadata', error));
  }

  private async load() {
    this.version = await this.stats.getVersion();
    this.baseUrl = await this.stats.getDownloadBaseUrl();

    if (isPlatformBrowser(this.platformId)) {
      this.setupIntersectionObserver();
    }
  }

  // Null rather than a URL while the release is unknown: an anchor with no href
  // is inert, which is the honest state for a link whose target cannot be named
  // yet. It becomes a real link the moment the database answers.
  getDownloadUrl(file: string): string | null {
    const version = this.version;
    return version ? buildUrl(this.baseUrl, version, file) : null;
  }

  getMappingUrl(dbPrefix: string, suffix: string): string | null {
    const version = this.version;
    return version ? buildMappingUrl(this.baseUrl, version, dbPrefix, suffix) : null;
  }

  toggleInfo(key: string): void {
    this.expandedPanels[key] = !this.expandedPanels[key];
  }

  isInfoExpanded(key: string): boolean {
    return !!this.expandedPanels[key];
  }

  scrollTo(id: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.activeTocId.set(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    // Defer to allow template to render
    setTimeout(() => {
      for (const item of this.tocItems) {
        const el = document.getElementById(item.id);
        if (el) this.observer!.observe(el);
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
