import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  OnDestroy,
  signal,
  TemplateRef,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { ParticipantService } from '../../../services/participant.service';
import { Molecule, ShownParticipant } from '../../../model/participant.model';
import { EntityService } from '../../../services/entity.service';
import { SelectableObject } from '../../../services/event.service';
import { rxResource } from '@angular/core/rxjs-interop';
import { ReferenceEntity } from '../../../model/graph/reference-entity/reference-entity.model';
import { SortByTextPipe } from '../../../pipes/sort-by-text.pipe';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MoleculeDownloadTableComponent } from './molecule-download-table/molecule-download-table.component';
import { UrlStateService } from '../../../services/url-state.service';
import { DataStateService } from '../../../services/data-state.service';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { isPathway, observeSections } from '../../../services/utils';
import { MoleculeGroupComponent } from './molecule-group/molecule-group.component';

// TODO: Find a way to not crash when too many data, e.g. selecting a top level pathway. (using virtual scrolls probably, but wit a way to expand rows)

export type MoleculeGroup = {
  category: string;
  data: MoleculeData[];
  found?: number;
};

export type MoleculeData = {
  entity: Molecule;
  stoichiometry: number;
  highlight: boolean;
};

@Component({
  selector: 'cr-molecule-tab',
  templateUrl: './molecule-tab.component.html',
  imports: [
    SortByTextPipe,
    MatProgressSpinner,
    MoleculeDownloadTableComponent,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    MatIcon,
    MoleculeGroupComponent,
  ],
  styleUrl: './molecule-tab.component.scss',
})
export class MoleculeTabComponent implements OnDestroy {
  private participant: ParticipantService = inject(ParticipantService);
  private entity: EntityService = inject(EntityService);
  private dataState = inject(DataStateService);
  private state: UrlStateService = inject(UrlStateService);

  readonly selectableObject = input.required<SelectableObject>();
  /** The selection given is a stand-in while a new one loads: no highlighting. */
  readonly selectionPending = input(false);
  pathwayId = this.state.pathwayId as WritableSignal<string>;
  // Get selected pathway id on Reacfoam view
  readonly objStId = computed(() =>
    this.pathwayId() ? this.pathwayId() : this.selectableObject().stId
  );
  readonly hasNoMoleculeData = computed(() => !(this.state.select() || this.state.pathwayId()));

  readonly selectedKey = signal<string>('');

  /** Whether something inside the open pathway, other than the pathway itself, is selected. */
  private readonly selectedInPathway = computed(
    () =>
      !this.hasNoMoleculeData() &&
      !this.selectionPending() &&
      !!this.pathwayId() &&
      this.selectableObject().stId !== this.pathwayId()
  );
  /**
   * Whether that selection lists its own molecules: then the tab lists them,
   * not the whole pathway's with the selection's highlighted, which read as an
   * unexplained mix of blue and white rows (FR-044).
   */
  readonly selectionInside = computed(
    () => this.selectedInPathway() && !this.dataState.selectIsSummary()
  );
  /**
   * One molecule is selected (from search, or with its locate button): it is
   * shown among the pathway's, highlighted, not listed alone as a one-row tab.
   */
  readonly oneMolecule = computed(
    () => this.selectedInPathway() && this.dataState.selectIsSummary()
  );
  /**
   * The selection's molecules are on their way: the tab keeps what it showed
   * rather than filtering against nothing, which emptied it ("No molecules are
   * listed") for the length of the request.
   */
  readonly selectionMoleculesLoading = computed(
    () =>
      this.selectedInPathway() &&
      // Not only while the request runs: until the service holds this
      // selection's molecules, it holds none or the last selection's.
      (this.entity.eventId() !== this.selectableObject().stId ||
        this.entity._refEntities.isLoading())
  );
  /** The reader asked for the whole pathway's molecules; a new selection asks again. */
  readonly showAll = linkedSignal({
    source: () => this.selectableObject().stId,
    computation: () => false,
  });
  readonly selectionName = computed(() => this.selectableObject().displayName);
  /** Whose molecules the tab lists when nothing inside the pathway is selected. */
  readonly listedName = computed(
    () => this.dataState.currentPathway()?.displayName ?? this.selectionName()
  );
  /** Whose molecules are listed: the file the download writes is named for it. */
  readonly listedId = computed(() =>
    this.selectionInside() && !this.showAll() ? this.selectableObject().stId : this.objStId()
  );
  /** How many molecules are listed: what the download writes. */
  readonly listedCount = computed(() =>
    this.moleculeData().reduce((sum, group) => sum + group.data.length, 0)
  );
  private dialog = inject(MatDialog);
  private readonly downloadDialog = viewChild.required<TemplateRef<unknown>>('downloadDialog');

  openDownload() {
    this.dialog.open(this.downloadDialog(), {
      width: '720px',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }
  readonly pathwayName = computed(
    () => this.dataState.currentPathway()?.displayName ?? 'this pathway'
  );
  private manualSelection = false;
  private observer?: () => void;

  constructor() {
    effect(() => {
      const selectableObjStId = this.selectableObject().stId;
      const pathwayId = this.pathwayId();
      // A stand-in's molecules are not wanted: it may be another pathway's.
      if (this.selectionPending()) return;
      if (selectableObjStId && selectableObjStId !== pathwayId) {
        this.entity.loadRefEntities(selectableObjStId);
      }
    });

    effect(() => {
      const [first] = this.moleculeData();
      if (first) {
        const id = this.sanitizeId(first.category);
        this.selectedKey.set(id);
      }
    });

    effect(() => {
      const ids = this.moleculeData().map((e) => this.sanitizeId(e.category));
      // The last observer goes first: one was added on every change of the list.
      this.observer?.();
      this.observer = observeSections(ids, this.selectedKey, this.manualSelection, false);
    });
  }

  ngOnDestroy(): void {
    this.observer?.();
  }

  _pathwayParticipants = rxResource({
    params: () => this.objStId(),
    stream: () => this.participant.getParticipants(this.objStId()),
  });

  /**
   * The pathway's molecules, and while another pathway's load, the last ones:
   * the list stays on screen, marked as updating, rather than vanishing behind
   * a spinner. Only the first load has nothing to show.
   */
  readonly pathwayParticipants = linkedSignal<
    { value: ShownParticipant[] | undefined; loading: boolean },
    ShownParticipant[] | undefined
  >({
    source: () => ({
      value: this._pathwayParticipants.hasValue() ? this._pathwayParticipants.value() : undefined,
      loading: this._pathwayParticipants.isLoading(),
    }),
    computation: (source, previous) =>
      source.value ?? (source.loading ? previous?.value : undefined),
  });
  readonly updating = computed(
    () => this._pathwayParticipants.isLoading() && !!this.pathwayParticipants()
  );
  /**
   * A new selection is on its way, first the selection itself and then its
   * molecules: the last list is held until both are in (FR-047). Held through
   * the first part too, which otherwise listed the whole pathway, unshaded,
   * under the new selection's name.
   */
  readonly holding = computed(() => this.selectionPending() || this.selectionMoleculesLoading());
  /** Busy while either the list or the selection behind its highlighting loads. */
  readonly busy = computed(() => this.updating() || this.holding());

  private readonly freshMoleculeData = computed(() => {
    let moleculeData: MoleculeGroup[] = [];

    const pathwayParticipants = this.pathwayParticipants();
    if (!pathwayParticipants) return [];

    const pathwayResults = this.getPathwayParticipants(pathwayParticipants);

    if (!this.hasNoMoleculeData()) {
      if (
        this.selectionPending() ||
        this.selectableObject().stId === this.pathwayId() ||
        !this.pathwayId()
      ) {
        moleculeData = pathwayResults;
      } else {
        const refEntities = this.entity.refEntities() || [];
        moleculeData = this.getReactionParticipants(pathwayResults, refEntities);
        if (this.selectionInside() && !this.showAll())
          moleculeData = onlyTheSelection(moleculeData);
      }
    } else {
      if (isPathway(this.selectableObject())) {
        moleculeData = pathwayResults;
      }
    }

    moleculeData.sort((a, b) => a.category.localeCompare(b.category));
    return moleculeData;
  });
  readonly moleculeData = linkedSignal<
    { loading: boolean; data: MoleculeGroup[] },
    MoleculeGroup[]
  >({
    source: () => ({ loading: this.holding(), data: this.freshMoleculeData() }),
    // Nothing to hold on the first load: the fresh list, whatever it is.
    computation: (source, previous) =>
      source.loading && previous?.value.length ? previous.value : source.data,
  });

  getPathwayParticipants(pathwayParticipants: ShownParticipant[]) {
    const groupedMap = new Map<string, Map<number, MoleculeData>>();
    const allRefEntities = pathwayParticipants.flatMap((participant) => participant.refEntities);

    for (const entity of allRefEntities) {
      const type = entity.type;

      if (!groupedMap.has(type)) {
        groupedMap.set(type, new Map());
      }

      const dataMap = groupedMap.get(type)!;
      const existingEntity = dataMap.get(entity.dbId);

      if (existingEntity) {
        existingEntity.stoichiometry++;
        // existingEntity.stoichiometry = (existingEntity.stoichiometry ?? 0) + 1;
      } else {
        dataMap.set(entity.dbId, { entity, stoichiometry: 1, highlight: false });
      }
    }

    const finalResults: MoleculeGroup[] = Array.from(groupedMap, ([category, dataMap]) => ({
      category,
      data: Array.from(dataMap.values()),
    }));
    return finalResults;
  }

  getReactionParticipants(pathwayResults: MoleculeGroup[], refEntities: ReferenceEntity[]) {
    const dbIds = new Set(refEntities.map((e) => e.dbId));
    return pathwayResults.map((group) => {
      let found = 0;
      const updatedData = group.data.map((molecule) => {
        const isFound = dbIds.has(molecule.entity.dbId);
        if (isFound) found++;
        return {
          ...molecule,
          highlight: isFound,
        };
      });

      return {
        ...group,
        data: updatedData,
        found,
      };
    });
  }

  scrollTo(type: string) {
    this.manualSelection = true;
    const id = this.sanitizeId(type);
    this.selectedKey.set(id);

    const element = document.getElementById(`${id}`);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'start',
      });
      // allow observer updates again after scroll completes
      setTimeout(() => {
        this.manualSelection = false;
      }, 1000);
    }
  }

  sanitizeId(label: string): string {
    return label
      .toLowerCase()
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/[^a-z0-9-_]/g, ''); // Remove special characters
  }
}

/** The selection's molecules alone: highlighting them all would mark nothing. */
function onlyTheSelection(groups: MoleculeGroup[]): MoleculeGroup[] {
  return groups
    .map((group) => ({
      category: group.category,
      data: group.data
        .filter((molecule) => molecule.highlight)
        .map((molecule) => ({ ...molecule, highlight: false })),
    }))
    .filter((group) => group.data.length > 0);
}
