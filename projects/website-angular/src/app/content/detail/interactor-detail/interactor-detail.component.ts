import { SearchResult } from '../../../../model/search.model';
import { Component, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PageLayoutComponent } from '../../../page-layout/page-layout.component';
import { TileComponent } from '../../../reactome-components/tile/tile.component';
import { CONTENT_SERVICE } from '../../../../../../pathway-browser/src/environments/environment';
import { InteractionWithEntities } from '../../../../model/interactor.model';
// The search's own types: its type filter is not applied, so the first hit can
// be an Icon, which has no reference identifier, URL or database.

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

  readonly acc = signal('');
  readonly interactions = signal<CustomInteraction[]>([]);
  readonly loading = signal(true);
  // A 404 means Reactome has no interactions for the accession, and a 400 that
  // the address is no accession at all; any other failure says nothing about it.
  readonly notFound = signal(false);
  readonly failed = signal(false);

  // Summary fields
  readonly displayName = signal('');
  readonly interactorType = signal('');
  readonly species = signal('');
  readonly synonyms = signal<string[]>([]);
  readonly referenceURL = signal('');

  // Reactome entity mapping: interactor identifier -> ReactomeEntity[]
  readonly entityMap = signal<Record<string, ReactomeEntity[]>>({});

  ngOnInit() {
    const acc = this.route.snapshot.paramMap.get('acc');
    if (!acc) {
      this.loading.set(false);
      this.notFound.set(true);
      return;
    }

    this.acc.set(acc);
    // An isoform's accession without its suffix: P04637-2 is P04637.
    const [baseAcc = acc] = acc.split('-');

    // One backend round-trip pulls interactions WITH each partner's
    // Reactome physical entities pre-resolved -- previously this fanned
    // out a /references/mapping/{id}/xrefs call per interactor (TP53 has
    // ~250) plus a batch /data/query/ids POST, all stitched client-side.
    forkJoin({
      interactions: this.http.get<InteractionWithEntities[]>(
        `${CONTENT_SERVICE}/interactors/static/molecule/${encodeURIComponent(acc)}/withEntities`
      ),
      search: this.http
        .get<SearchResult>(`${CONTENT_SERVICE}/search/query`, {
          params: { query: acc, types: 'Interactor', cluster: 'true' },
        })
        .pipe(catchError(() => of(null))),
      uniprot: this.http
        .get<UniProtResponse>(
          `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(baseAcc)}.json`
        )
        .pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ interactions, search, uniprot }) => {
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
            entitiesCount: row.physicalEntity.length,
          });
          entityMap[row.accession] = row.physicalEntity.map((pe) => ({
            stId: pe.stId,
            displayName: pe.displayName,
          }));
        }
        this.interactions.set(projected);
        this.entityMap.set(entityMap);

        // Extract summary from search result
        // The first hit that is a reference: when nothing matches as an
        // interactor the search answers unfiltered, and an Icon can lead.
        const entry = search?.results
          .flatMap((group) => group.entries)
          .find((hit) => hit.databaseName && hit.referenceIdentifier);
        if (entry) {
          const cleanId = (entry.referenceIdentifier ?? acc).replace(/<[^>]*>/g, '');
          this.displayName.set(`${entry.databaseName}:${cleanId} ${entry.name}`);
          this.interactorType.set(
            `${entry.type}${entry.exactType && entry.exactType !== entry.type ? ' (' + entry.exactType + ')' : ''}`
          );
          this.species.set(entry.species?.[0] ?? '');
          this.referenceURL.set(
            entry.referenceURL ?? `https://www.uniprot.org/uniprotkb/${acc}/entry`
          );
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
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 400))
          this.notFound.set(true);
        else this.failed.set(true);
        this.loading.set(false);
      },
    });
  }
}
