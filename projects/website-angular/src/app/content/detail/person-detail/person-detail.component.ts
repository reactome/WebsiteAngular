import { Component, computed, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, map, merge, type Observable, switchMap, tap } from 'rxjs';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { PageLayoutComponent } from '../../../page-layout/page-layout.component';
import {
  CONTENT_SERVICE,
  CONTENT_DETAIL_PATH,
} from '../../../../../../pathway-browser/src/environments/environment';

interface Affiliation {
  dbId: number;
  displayName: string;
  address?: string;
  name?: string[];
}

interface Publication {
  dbId: number;
  title?: string;
  displayName?: string;
  author?: number[];
  journal?: string;
  pages?: string;
  pubMedIdentifier?: number;
  url?: string;
  volume?: number;
  year?: number;
}

interface Person {
  dbId: number;
  displayName: string;
  firstname?: string;
  surname?: string;
  initial?: string;
  orcidId?: string;
  project?: string;
  affiliation?: Affiliation[];
  publications?: Publication[];
}

type SectionKey =
  'authoredPathways' | 'authoredReactions' | 'reviewedPathways' | 'reviewedReactions';

/** Only a 404 means "there is none"; anything else is a failure to say so. */
const isNotFound = (error: unknown) => error instanceof HttpErrorResponse && error.status === 404;

// Returned by /data/person/{id}/{authored,reviewed}{Pathways,Reactions}.
// Matches Reactome's SimpleEventProjection DTO.
interface SimpleEvent {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName?: string;
  schemaClass?: string;
}

@Component({
  selector: 'app-person-detail',
  standalone: true,
  imports: [
    PageLayoutComponent,
    NgTemplateOutlet,
    MatProgressSpinner,
    RouterLink,
    MatIcon,
    MatIconButton,
    MatButton,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
  ],
  templateUrl: './person-detail.component.html',
  styleUrl: './person-detail.component.scss',
})
export class PersonDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);

  readonly person = signal<Person | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly failed = signal(false);
  readonly contributionsFailed = signal(false);

  readonly authoredPathways = signal<SimpleEvent[]>([]);
  readonly authoredReactions = signal<SimpleEvent[]>([]);
  readonly reviewedPathways = signal<SimpleEvent[]>([]);
  readonly reviewedReactions = signal<SimpleEvent[]>([]);

  readonly publicationsSorted = computed(() => {
    const pubs = this.person()?.publications ?? [];
    return [...pubs].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  });

  protected readonly CONTENT_DETAIL_PATH = CONTENT_DETAIL_PATH;

  ngOnInit() {
    // paramMap (not snapshot) so navigating between /content/detail/person/A
    // and /content/detail/person/B re-fetches; switchMap so A's answers,
    // arriving late, are dropped rather than drawn over B's.
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private load(id: string | null): Observable<unknown> {
    this.person.set(null);
    this.notFound.set(false);
    this.failed.set(false);
    this.contributionsFailed.set(false);
    this.authoredPathways.set([]);
    this.authoredReactions.set([]);
    this.reviewedPathways.set([]);
    this.reviewedReactions.set([]);
    this.resetSectionExtras();
    if (!id) {
      this.loading.set(false);
      this.notFound.set(true);
      return EMPTY;
    }
    this.loading.set(true);

    // /data/person/{id} accepts either the numeric dbId or the ORCID.
    const person = this.http.get<Person>(`${CONTENT_SERVICE}/data/person/${id}`).pipe(
      tap((data) => {
        this.person.set(data);
        this.loading.set(false);
      }),
      catchError((error: unknown) => {
        if (isNotFound(error)) this.notFound.set(true);
        else this.failed.set(true);
        this.loading.set(false);
        return EMPTY;
      })
    );

    // Authored/reviewed pathways and reactions come from four separate
    // endpoints, fetched in parallel. Someone with no contributions of a
    // kind gets an empty list; a 404 (a backend without the endpoint) leaves
    // the section empty too. Anything else is said on the page, so a failed
    // list does not read as someone who contributed nothing.
    return merge(
      person,
      this.fetchEvents(id, 'authoredPathways'),
      this.fetchEvents(id, 'authoredReactions'),
      this.fetchEvents(id, 'reviewedPathways'),
      this.fetchEvents(id, 'reviewedReactions')
    );
  }

  private fetchEvents(id: string, key: SectionKey) {
    return this.http.get<SimpleEvent[]>(`${CONTENT_SERVICE}/data/person/${id}/${key}`).pipe(
      tap((list) => this[key].set(list)),
      catchError((error: unknown) => {
        if (!isNotFound(error)) this.contributionsFailed.set(true);
        return EMPTY;
      })
    );
  }

  pubMedUrl(pmid: number): string {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}`;
  }

  // Build a /ContentService/citation/export?... URL for a given event so
  // the per-row export menu items can be plain download links (the
  // browser does the GET and saves the response). dateAccessed is the
  // current UTC date in YYYY-MM-DD form.
  citationExportUrl(dbId: number, format: 'bib' | 'ris' | 'txt'): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${CONTENT_SERVICE}/citation/export?id=${dbId}&ext=${format}&isPathway=true&dateAccessed=${date}`;
  }

  // Per-section expand/collapse state. Each section header is clickable
  // and toggles independently; the bulk button at the top sets all four
  // at once. Default: all expanded.
  private readonly sectionState = signal<Record<SectionKey, boolean>>({
    authoredPathways: true,
    authoredReactions: true,
    reviewedPathways: true,
    reviewedReactions: true,
  });

  // Per-section quick-filter query, species selection, and "show all"
  // flag. Long lists (>20 rows) start truncated; the search box matches
  // displayName (case-insensitive contains); species chips narrow to a
  // single organism.
  private readonly sectionExtras = signal<
    Record<SectionKey, { showAll: boolean; query: string; species: string }>
  >({
    authoredPathways: { showAll: false, query: '', species: '' },
    authoredReactions: { showAll: false, query: '', species: '' },
    reviewedPathways: { showAll: false, query: '', species: '' },
    reviewedReactions: { showAll: false, query: '', species: '' },
  });

  private static readonly SECTION_TRUNCATE = 20;
  private static readonly FILTER_THRESHOLD = 10;
  readonly SECTION_TRUNCATE = PersonDetailComponent.SECTION_TRUNCATE;
  readonly FILTER_THRESHOLD = PersonDetailComponent.FILTER_THRESHOLD;

  isSectionExpanded(key: SectionKey): boolean {
    return this.sectionState()[key];
  }

  toggleSection(key: SectionKey) {
    this.sectionState.update((s) => ({ ...s, [key]: !s[key] }));
  }

  readonly allExpanded = computed(() => {
    const s = this.sectionState();
    return s.authoredPathways && s.authoredReactions && s.reviewedPathways && s.reviewedReactions;
  });

  toggleExpandAll() {
    const target = !this.allExpanded();
    this.sectionState.set({
      authoredPathways: target,
      authoredReactions: target,
      reviewedPathways: target,
      reviewedReactions: target,
    });
  }

  getQuery(key: SectionKey): string {
    return this.sectionExtras()[key].query;
  }

  getSpecies(key: SectionKey): string {
    return this.sectionExtras()[key].species;
  }

  isShowAll(key: SectionKey): boolean {
    return this.sectionExtras()[key].showAll;
  }

  onFilterInput(key: SectionKey, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    // Reset showAll when the user types -- filtered results are
    // usually small enough to render in full; the slice only kicks in
    // for unfiltered views.
    this.sectionExtras.update((s) => ({
      ...s,
      [key]: { ...s[key], showAll: false, query: value },
    }));
  }

  clearFilter(key: SectionKey) {
    this.sectionExtras.update((s) => ({ ...s, [key]: { ...s[key], query: '' } }));
  }

  setSpecies(key: SectionKey, species: string) {
    this.sectionExtras.update((s) => ({ ...s, [key]: { ...s[key], showAll: false, species } }));
  }

  toggleShowAll(key: SectionKey) {
    this.sectionExtras.update((s) => ({ ...s, [key]: { ...s[key], showAll: !s[key].showAll } }));
  }

  private matchQuery(row: SimpleEvent, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.displayName.toLowerCase().includes(q);
  }

  filteredRows(rows: SimpleEvent[], query: string, species: string): SimpleEvent[] {
    if (!query.trim() && !species) return rows;
    return rows.filter((r) => this.matchQuery(r, query) && (!species || r.speciesName === species));
  }

  visibleRows(key: SectionKey, rows: SimpleEvent[]): SimpleEvent[] {
    const { showAll, query, species } = this.sectionExtras()[key];
    const filtered = this.filteredRows(rows, query, species);
    if (showAll || query.trim() || species) return filtered;
    return filtered.slice(0, PersonDetailComponent.SECTION_TRUNCATE);
  }

  filteredCount(key: SectionKey, rows: SimpleEvent[]): number {
    const { query, species } = this.sectionExtras()[key];
    return this.filteredRows(rows, query, species).length;
  }

  // Species facet counts honor the current search box (so if the user
  // is searching "DNA", the chip count for Homo sapiens reflects only
  // rows that match both). They ignore the currently-selected species
  // -- otherwise selecting one would hide all other chips.
  speciesFacets(key: SectionKey, rows: SimpleEvent[]): { name: string; count: number }[] {
    const { query } = this.sectionExtras()[key];
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!this.matchQuery(r, query)) continue;
      const n = r.speciesName;
      if (!n) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  private resetSectionExtras() {
    this.sectionExtras.set({
      authoredPathways: { showAll: false, query: '', species: '' },
      authoredReactions: { showAll: false, query: '', species: '' },
      reviewedPathways: { showAll: false, query: '', species: '' },
      reviewedReactions: { showAll: false, query: '', species: '' },
    });
  }
}
