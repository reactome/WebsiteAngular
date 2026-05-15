import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
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
  imports: [PageLayoutComponent, MatProgressSpinner, RouterLink],
  templateUrl: './person-detail.component.html',
  styleUrl: './person-detail.component.scss',
})
export class PersonDetailComponent {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  person = signal<Person | null>(null);
  loading = signal(true);
  error = signal(false);

  authoredPathways = signal<SimpleEvent[]>([]);
  authoredReactions = signal<SimpleEvent[]>([]);
  reviewedPathways = signal<SimpleEvent[]>([]);
  reviewedReactions = signal<SimpleEvent[]>([]);

  publicationsSorted = computed(() => {
    const pubs = this.person()?.publications ?? [];
    return [...pubs].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  });

  protected readonly CONTENT_DETAIL_PATH = CONTENT_DETAIL_PATH;

  ngOnInit() {
    // paramMap subscription (not snapshot) so navigating between
    // /content/detail/person/A and /content/detail/person/B re-fetches.
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.loading.set(false);
        this.error.set(true);
        return;
      }
      this.loading.set(true);
      this.error.set(false);
      this.person.set(null);
      this.authoredPathways.set([]);
      this.authoredReactions.set([]);
      this.reviewedPathways.set([]);
      this.reviewedReactions.set([]);

      // /data/person/{id} accepts either the numeric dbId or the ORCID.
      this.http.get<Person>(`${CONTENT_SERVICE}/data/person/${id}`).subscribe({
        next: (data) => {
          this.person.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });

      // Authored/reviewed pathways and reactions come from four separate
      // endpoints. We fire them in parallel and tolerate 404s (some persons
      // have no contributions of a given type, or the backend may not have
      // the new endpoints deployed yet -- the section just stays empty).
      this.fetchEvents(`${CONTENT_SERVICE}/data/person/${id}/authoredPathways`, this.authoredPathways);
      this.fetchEvents(`${CONTENT_SERVICE}/data/person/${id}/authoredReactions`, this.authoredReactions);
      this.fetchEvents(`${CONTENT_SERVICE}/data/person/${id}/reviewedPathways`, this.reviewedPathways);
      this.fetchEvents(`${CONTENT_SERVICE}/data/person/${id}/reviewedReactions`, this.reviewedReactions);
    });
  }

  private fetchEvents(url: string, target: ReturnType<typeof signal<SimpleEvent[]>>) {
    this.http
      .get<SimpleEvent[]>(url)
      .pipe(catchError(() => of<SimpleEvent[]>([])))
      .subscribe((list) => target.set(list ?? []));
  }

  pubMedUrl(pmid: number): string {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}`;
  }
}
