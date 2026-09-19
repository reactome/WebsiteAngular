import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  linkedSignal,
  signal,
  viewChild,
  inject,
} from '@angular/core';
import { DatabaseIdentifier } from '../../../../model/graph/database-identifier.model';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOptgroup, MatOption, MatSelect } from '@angular/material/select';
import { rxResource } from '@angular/core/rxjs-interop';
import { extract, Style } from 'reactome-cytoscape-style';
import { DarkService } from '../../../../services/dark.service';
import { ReferenceEntity } from '../../../../model/graph/reference-entity/reference-entity.model';
import { catchError, map, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { SafePipe } from '../../../../pipes/safe.pipe';
import { SelectableObject } from '../../../../services/event.service';
import { MoleculeType } from '../molecule-tab.component';
import { StructureService } from '../../../../services/structure.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

export interface StructureEntry {
  pdb_id: string;
  chain_id: string;
  experimental_method: string;
  tax_id: number;
  coverage: number;
  resolution: number;
  start: number;
  end: number;
  unp_start: number;
  unp_end: number;
}

interface BestStructure {
  [key: string]: StructureEntry[];
}

interface AlphaFoldSummary {
  uniprot_entry: {
    ac: string;
    id: string;
    uniprot_checksum: string;
    sequence_length: number;
    segment_start: number;
    segment_end: number;
  };

  structures: {
    summary: {
      model_identifier: string;
      model_category: string;
      model_url: string;
      model_format: string;
      model_type?: null;
      model_page_url: string;
      provider: string;
      number_of_conformers?: number;
      ensemble_sample_url?: string;
      ensemble_sample_format?: string;
      created: Date;
      sequence_identity: number;
      uniprot_start: number;
      uniprot_end: number;
      coverage: number;
      experimental_method?: string;
      resolution?: string;
      confidence_type?: string;
      confidence_version?: number;
      confidence_avg_local_score: number;
      oligomeric_state?: string;
      preferred_assembly_id?: string;
      entities: {
        entity_type: string;
        entity_poly_type: string;
        identifier: string;
        identifier_category: string;
        description: string;
        chain_ids: string[];
      }[];
    };
  }[];
}

export enum Source {
  ALPHA_FOLD = 'AlphaFold',
  PDB = 'PDB',
}

// Global variable avoid typescript errors
declare const PDBeMolstarPlugin: any;

@Component({
  selector: 'cr-structure-viewer',
  templateUrl: './structure-viewer.component.html',
  imports: [
    MatLabel,
    MatFormField,
    MatSelect,
    MatOptgroup,
    MatOption,
    SafePipe,
    MatProgressSpinner,
  ],
  styleUrl: './structure-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StructureViewerComponent {
  private dark = inject(DarkService);
  private http = inject(HttpClient);
  private structure = inject(StructureService);

  readonly obj = input.required<ReferenceEntity | SelectableObject>();
  readonly xRefs = input.required<DatabaseIdentifier[]>();
  readonly moleculeType = input.required<string | null>();
  viewer = viewChild<ElementRef<HTMLElement>>('viewer');
  isProtein = computed(() => this.moleculeType() === MoleculeType.PROTEIN);
  isChemical = computed(
    () =>
      this.moleculeType() === MoleculeType.CHEMICAL ||
      this.moleculeType() === MoleculeType.CHEMICAL_DRUG
  );
  chebiIdentifier = signal<string | undefined>(undefined);

  pdbIdentifiers = computed(() => this.getPDBIdentifiers(this.xRefs()));

  reactomeStyle: Style = new Style(document.body);

  alphaFoldEntryId = linkedSignal(() => {
    if (!this.isProtein()) return null;
    const summary = this.alphafoldSummary.value();
    if (summary?.structures?.[0]?.summary?.model_url) {
      const id = this.obj().identifier;
      return `AF-${id}-F1`;
    }
    return null;
  });

  selected = signal<string | null>(null);

  sourceLabel = computed(() => {
    return this.selected()?.startsWith('AF-') ? Source.ALPHA_FOLD : Source.PDB;
  });

  /** protein structure data from AlphaFold and PDB */
  proteinStructureData = computed(() => {
    if (!this.isProtein()) return null;
    const result = [];

    // Experimental first, so the list a reader sees is ordered the same way the
    // default is chosen rather than contradicting it.
    const pdbIdentifiers = this.pdbIdentifiers();
    if (pdbIdentifiers.length > 0) result.push({ source: Source.PDB, identifiers: pdbIdentifiers });

    const afId = this.alphaFoldEntryId();
    if (afId) result.push({ source: Source.ALPHA_FOLD, identifiers: [afId] });

    return result;
  });

  chebiStructureSVGData = rxResource({
    params: this.chebiIdentifier,
    stream: ({ params }) => {
      const id = params;
      if (!id) return of(undefined); // NG0991: must emit
      return this.http
        .get(`https://www.ebi.ac.uk/chebi/backend/api/public/compound/${id}/structure/`, {
          responseType: 'text',
        })
        .pipe(catchError(() => of(undefined)));
    },
  });

  isChebiLoading = computed(() => this.chebiStructureSVGData.isLoading());

  isAlphafoldSummaryLoading = computed(() => this.alphafoldSummary.isLoading());

  bestPdbStructure = rxResource({
    params: () => this.obj().identifier,
    stream: ({ params }) => {
      if (!this.isProtein()) return of(undefined); // NG0991: must emit
      const id = params;
      return this.http
        .get<BestStructure>(`https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/${id}/`)
        .pipe(
          map((response) => {
            const value = response[id];
            const ids = new Set(value.map((item) => item.pdb_id.toUpperCase()));
            return Array.from(ids);
          }),
          catchError(() => of(undefined))
        );
    },
  });

  alphafoldSummary = rxResource({
    params: () => this.obj().identifier,
    stream: ({ params }) => {
      if (!this.isProtein()) return of(undefined); // NG0991: must emit
      const id = params;
      return this.http.get<AlphaFoldSummary>(
        `https://alphafold.ebi.ac.uk/api/uniprot/summary/${id}.json`
      );
    },
  });

  alphafoldUrl = computed(
    () =>
      this.alphafoldSummary.value()?.structures?.[0]?.summary?.model_url ||
      `https://alphafold.ebi.ac.uk/files/${this.alphaFoldEntryId()}-model_v6.cif`
  );

  hasAnyStructure = computed(
    () => this.chebiStructureSVGData.hasValue() || !!this.proteinStructureData()?.length
  );

  bgColor = computed(() => {
    this.dark.isDark(); // Compute on dark update
    return extract(this.reactomeStyle.properties.global.surface);
  });

  constructor() {
    effect(() => {
      const [isProtein, isChemical] = [this.isProtein(), this.isChemical()];

      if (isProtein) {
        this.getProteinStructure();
      } else if (isChemical) {
        const identifier =
          this.obj().databaseName === 'ChEBI'
            ? this.obj().identifier
            : (this.obj().crossReference as DatabaseIdentifier[]).find(
                (c) => c.databaseName === 'ChEBI'
              )?.identifier;
        if (identifier) this.chebiIdentifier.set(identifier);
      }
    });

    effect(() => {
      this.structure.hasAnyStructure.set(this.hasAnyStructure());
    });

    effect(() => {
      if (!this.isProtein()) {
        this.selected.set(null);
        return;
      }

      // An experimental structure always wins when the entity has one, and
      // AlphaFold's prediction is what you get when it does not. Decided on a
      // sitewide call, 19 Sep 2026.
      //
      // This used to prefer AlphaFold whenever AlphaFold had a model, so a
      // protein with both showed the prediction -- BCL2 has an experimental
      // 5JSN and was showing AF-P10415-F1. It also means the choice no longer
      // waits on AlphaFold's summary request: a PDB cross-reference is already
      // in hand from the entity, so there is nothing to wait for.
      // `pdbIdentifiers()` is re-sorted when EBI's best_structures ranking
      // arrives, so this can pick one entry and then move to a better one a
      // moment later -- a second viewer load, visible as a flicker on proteins
      // with several structures. That happened before this change too, on
      // proteins with no AlphaFold model; it is simply reached more often now.
      //
      // Not waited on deliberately: both candidates are experimental structures,
      // so the decision this implements is satisfied either way, and waiting
      // would make the first render depend on a third-party request that has no
      // timeout. Showing the right kind of structure promptly beats showing the
      // best-ranked one eventually.
      const pdbId = this.pdbIdentifiers()?.[0];
      if (pdbId) {
        this.selected.set(pdbId);
        return;
      }

      if (!this.isAlphafoldSummaryLoading()) {
        // No experimental structure. AlphaFold's model if it has one, and
        // nothing if it does not.
        this.selected.set(this.alphaFoldEntryId() ?? null);
      }
    });
  }

  getProteinStructure() {
    const viewerRef = this.viewer(); // signal value
    if (!viewerRef?.nativeElement) return;

    const selected = this.selected() || this.alphaFoldEntryId();
    if (!selected) return;

    // A PDB widget =>  https://github.com/molstar/pdbe-molstar/wiki/1.-PDBe-Molstar-as-JS-plugin
    const viewerInstance = new PDBeMolstarPlugin();
    const options = {
      bgColor: this.bgColor(),
      hideControls: true,
      landscape: true,
    };

    const pdbOptions = {
      moleculeId: selected.toLowerCase(),
      ...options,
    };

    const alphaFoldOptions = {
      customData: {
        url: this.alphafoldUrl(),
        format: 'cif',
      },
      alphafoldView: true,
      ...options,
    };

    // If only alfaFold data is available, check if the structure is available
    if (this.alphaFoldEntryId()) {
      // A failed request means the structure cannot be shown either, so treat
      // it the same as a 404 rather than leaving the id set and rendering a
      // viewer for something that is not there.
      fetch(this.alphafoldUrl(), { method: 'HEAD' })
        .then((response) => {
          if (!response.ok) this.alphaFoldEntryId.set(null);
        })
        .catch(() => this.alphaFoldEntryId.set(null));
    }

    const finalOptions = selected.startsWith('AF-') ? alphaFoldOptions : pdbOptions;
    viewerInstance.render(viewerRef.nativeElement, finalOptions);
  }

  getPDBIdentifiers(xRefs: DatabaseIdentifier[]) {
    const bestStructure = new Map(this.bestPdbStructure.value()?.map((id, index) => [id, index]));

    return xRefs
      .filter((ref: DatabaseIdentifier) => ref.databaseName === Source.PDB)
      .map((ref) => ref.identifier)
      .sort((a, b) => {
        if (bestStructure) {
          const aIndex = bestStructure.has(a) ? bestStructure.get(a)! : Number.MAX_SAFE_INTEGER;
          const bIndex = bestStructure.has(b) ? bestStructure.get(b)! : Number.MAX_SAFE_INTEGER;

          if (aIndex !== bIndex) {
            return aIndex - bIndex;
          }
        }
        // fallback method when no best structure available
        return this.sortByAlphabeticalOrder(a, b);
      });
  }

  sortByAlphabeticalOrder(a: string, b: string) {
    //starts with digit
    const aDigit = /^\d/.test(a);
    const bDigit = /^\d/.test(b);

    if (aDigit && bDigit) {
      return a.localeCompare(b);
    } else if (aDigit) {
      return -1; // a comes before b
    } else if (bDigit) {
      return 1; // b comes before a
    } else {
      return a.localeCompare(b); // For non-digit,sort normally
    }
  }
}
