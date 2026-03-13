import {Component, inject, OnInit, signal} from '@angular/core';
import {DecimalPipe} from '@angular/common';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {HttpClient} from '@angular/common/http';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {forkJoin, of} from 'rxjs';
import {catchError, switchMap} from 'rxjs/operators';
import {PageLayoutComponent} from '../../../page-layout/page-layout.component';
import {TileComponent} from '../../../reactome-components/tile/tile.component';
import {CONTENT_SERVICE} from '../../../../../../pathway-browser/src/environments/environment';

export interface CustomInteraction {
  dbId: number;
  identifier: string;
  score: number;
  evidenceCount: number;
  url: string;
  evidenceURL: string;
  geneName?: string[];
  databaseName?: string;
  entitiesCount?: number;
  speciesName?: string;
  displayName?: string;
}

export interface ReactomeEntity {
  stId: string;
  displayName: string;
}

interface XrefMapping {
  reference: string;
  physicalEntities: string[];
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

    forkJoin({
      interactions: this.http.get<CustomInteraction[]>(
        `${CONTENT_SERVICE}/interactors/static/molecule/enhanced/${encodeURIComponent(acc)}/details`
      ).pipe(catchError(() => of(null))),
      search: this.http.get<SearchResult>(
        `${CONTENT_SERVICE}/search/query`, {params: {query: acc, types: 'Interactor', cluster: 'true'}}
      ).pipe(catchError(() => of(null))),
      uniprot: this.http.get<UniProtResponse>(
        `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(baseAcc)}.json`
      ).pipe(catchError(() => of(null))),
    }).pipe(
      switchMap(({interactions, search, uniprot}) => {
        if (!interactions) {
          return of({interactions: null, search, uniprot, entityMap: {}});
        }

        // Fetch xrefs for each unique interactor identifier to get Reactome entities
        const identifiers = interactions.map(i => i.identifier).filter(Boolean);
        if (!identifiers.length) {
          return of({interactions, search, uniprot, entityMap: {}});
        }

        const xrefRequests: Record<string, ReturnType<typeof this.http.get>> = {};
        for (const id of identifiers) {
          xrefRequests[id] = this.http.get<XrefMapping[]>(
            `${CONTENT_SERVICE}/references/mapping/${encodeURIComponent(id)}/xrefs`
          ).pipe(catchError(() => of([])));
        }

        return forkJoin(xrefRequests).pipe(
          switchMap((xrefResults: Record<string, XrefMapping[] | unknown>) => {
            // Collect all physical entity stIds
            const allStIds: string[] = [];
            const idToStIds: Record<string, string[]> = {};

            for (const [id, xrefs] of Object.entries(xrefResults)) {
              const mappings = xrefs as XrefMapping[];
              const stIds: string[] = [];
              if (Array.isArray(mappings)) {
                for (const m of mappings) {
                  if (m.physicalEntities) stIds.push(...m.physicalEntities);
                }
              }
              idToStIds[id] = stIds;
              allStIds.push(...stIds);
            }

            if (!allStIds.length) {
              return of({interactions, search, uniprot, entityMap: {}});
            }

            // Batch fetch display names for all physical entities
            return this.http.post<{stId: string; displayName: string}[]>(
              `${CONTENT_SERVICE}/data/query/ids`,
              allStIds.join(','),
              {headers: {'Content-Type': 'text/plain'}}
            ).pipe(
              catchError(() => of([])),
              switchMap((entities) => {
                const entityLookup: Record<string, string> = {};
                if (Array.isArray(entities)) {
                  for (const e of entities) {
                    if (e?.stId) entityLookup[e.stId] = e.displayName;
                  }
                }

                const entityMap: Record<string, ReactomeEntity[]> = {};
                for (const [id, stIds] of Object.entries(idToStIds)) {
                  entityMap[id] = stIds
                    .filter(stId => entityLookup[stId])
                    .map(stId => ({stId, displayName: entityLookup[stId]}));
                }

                return of({interactions, search, uniprot, entityMap});
              })
            );
          })
        );
      })
    ).subscribe({
      next: ({interactions, search, uniprot, entityMap}) => {
        if (!interactions) {
          this.error.set(true);
          this.loading.set(false);
          return;
        }

        this.interactions.set(interactions);
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
