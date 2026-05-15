import {Component, inject, OnInit, signal} from '@angular/core';
import {DecimalPipe} from '@angular/common';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {HttpClient} from '@angular/common/http';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {forkJoin, of} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {PageLayoutComponent} from '../../../page-layout/page-layout.component';
import {TileComponent} from '../../../reactome-components/tile/tile.component';
import {CONTENT_SERVICE} from '../../../../../../pathway-browser/src/environments/environment';

export interface CustomInteraction {
  identifier: string;
  score: number;
  evidenceCount: number;
  url: string;
  evidenceURL: string;
  entitiesCount?: number;
}

export interface ReactomeEntity {
  stId: string;
  displayName: string;
}

// Shape returned by /interactors/static/molecule/{acc}/withEntities --
// each row is one interactor partner with its Reactome PhysicalEntities
// pre-joined (no client-side fan-out to /references/mapping/{id}/xrefs).
interface InteractionWithEntities {
  score: number;
  accession: string;
  accessionURL: string;
  physicalEntity: { dbId: number; stId: string; displayName: string; schemaClass: string }[];
  evidences: number;
  url: string;
}

interface SearchResult {
  results: { entries: SearchEntry[] }[];
}

interface SearchEntry {
  name: string;
  type: string;
  exactType: string;
  species: string[];
  databaseName: string;
  referenceIdentifier: string;
  referenceURL: string;
}

interface UniProtResponse {
  genes?: { geneName?: { value: string }; synonyms?: { value: string }[] }[];
  proteinDescription?: {
    recommendedName?: { fullName?: { value: string } };
    alternativeNames?: { fullName?: { value: string } }[];
  };
  organism?: { scientificName?: string };
}

@Component({
  selector: 'app-interactor-detail',
  standalone: true,
  imports: [PageLayoutComponent, TileComponent, MatProgressSpinner, DecimalPipe, RouterLink],
  templateUrl: './interactor-detail.component.html',
  styleUrl: './interactor-detail.component.scss',
})
export class InteractorDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  acc = signal('');
  interactions = signal<CustomInteraction[]>([]);
  loading = signal(true);
  error = signal(false);

  // Summary fields
  displayName = signal('');
  interactorType = signal('');
  species = signal('');
  synonyms = signal<string[]>([]);
  referenceURL = signal('');

  // Reactome entity mapping: interactor identifier -> ReactomeEntity[]
  entityMap = signal<Record<string, ReactomeEntity[]>>({});

  ngOnInit() {
    const acc = this.route.snapshot.paramMap.get('acc');
    if (!acc) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }

    this.acc.set(acc);
    const baseAcc = acc.split('-')[0];

    // One backend round-trip pulls interactions WITH each partner's
    // Reactome physical entities pre-resolved -- previously this fanned
    // out a /references/mapping/{id}/xrefs call per interactor (TP53 has
    // ~250) plus a batch /data/query/ids POST, all stitched client-side.
    forkJoin({
      interactions: this.http.get<InteractionWithEntities[]>(
        `${CONTENT_SERVICE}/interactors/static/molecule/${encodeURIComponent(acc)}/withEntities`
      ).pipe(catchError(() => of<InteractionWithEntities[] | null>(null))),
      search: this.http.get<SearchResult>(
        `${CONTENT_SERVICE}/search/query`, {params: {query: acc, types: 'Interactor', cluster: 'true'}}
      ).pipe(catchError(() => of(null))),
      uniprot: this.http.get<UniProtResponse>(
        `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(baseAcc)}.json`
      ).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({interactions, search, uniprot}) => {
        if (!interactions) {
          this.error.set(true);
          this.loading.set(false);
          return;
        }

        // Project the backend rows into the template's CustomInteraction
        // shape and build the entityMap inline.
        const projected: CustomInteraction[] = [];
        const entityMap: Record<string, ReactomeEntity[]> = {};
        for (const row of interactions) {
          projected.push({
            identifier: row.accession,
            score: row.score,
            evidenceCount: row.evidences,
            url: row.accessionURL,
            evidenceURL: row.url,
            entitiesCount: row.physicalEntity?.length ?? 0,
          });
          entityMap[row.accession] = (row.physicalEntity ?? []).map(pe => ({
            stId: pe.stId,
            displayName: pe.displayName,
          }));
        }
        this.interactions.set(projected);
        this.entityMap.set(entityMap);

        // Extract summary from search result
        const entry = search?.results?.[0]?.entries?.[0];
        if (entry) {
          const cleanId = (entry.referenceIdentifier ?? acc).replace(/<[^>]*>/g, '');
          this.displayName.set(`${entry.databaseName}:${cleanId} ${entry.name}`);
          this.interactorType.set(`${entry.type}${entry.exactType && entry.exactType !== entry.type ? ' (' + entry.exactType + ')' : ''}`);
          this.species.set(entry.species?.[0] ?? '');
          this.referenceURL.set(entry.referenceURL ?? `https://www.uniprot.org/uniprotkb/${acc}/entry`);
        } else {
          this.displayName.set(`UniProt:${acc}`);
          this.interactorType.set('Interactor');
          this.referenceURL.set(`https://www.uniprot.org/uniprotkb/${acc}/entry`);
        }

        // Extract synonyms from UniProt
        if (uniprot) {
          const syns: string[] = [];
          for (const gene of uniprot.genes ?? []) {
            for (const syn of gene.synonyms ?? []) {
              if (syn.value) syns.push(syn.value);
            }
          }
          const protDesc = uniprot.proteinDescription;
          for (const alt of protDesc?.alternativeNames ?? []) {
            if (alt.fullName?.value) syns.push(alt.fullName.value);
          }
          if (!this.species()) {
            this.species.set(uniprot.organism?.scientificName ?? '');
          }
          this.synonyms.set(syns);
        }

        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}
