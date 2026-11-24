import { Component, computed, input, inject } from '@angular/core';
import { ReferenceEntity } from '../../../model/graph/reference-entity/reference-entity.model';
import { EntityService } from '../../../services/entity.service';
import { isArray, isString } from 'lodash';
import { TitleCasePipe } from '@angular/common';
import { StructureViewerComponent } from '../../tabs/molecule-tab/structure-viewer/structure-viewer.component';
import { DatabaseIdentifier } from '../../../model/graph/database-identifier.model';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { UrlStateService } from '../../../services/url-state.service';
import { MatTooltip } from '@angular/material/tooltip';
import { DataStateService } from '../../../services/data-state.service';
import { Labels } from '../../../constants/constants';
import { MoleculeType } from '../../../model/molecule-type.model';
import { summarySelection } from './summary-selection';

@Component({
  selector: 'cr-external-reference',
  templateUrl: './external-reference.component.html',
  styleUrl: './external-reference.component.scss',
  imports: [TitleCasePipe, MatIcon, MatIconButton, MatTooltip, StructureViewerComponent],
})
export class ExternalReferenceComponent {
  private entity = inject(EntityService);
  private state = inject(UrlStateService);
  data = inject(DataStateService);

  readonly referenceEntity = input.required<ReferenceEntity>();
  readonly xRefs = input<DatabaseIdentifier[]>([]);

  readonly displayReference = input<boolean>(true);

  readonly externalRef = computed(() => {
    const rows = this.entity.getTransformedExternalRef(this.referenceEntity());
    // In the molecule tab the reference's own row is left out (its name is the
    // tree row's), so a DNA or RNA sequence with no gene names had nothing at
    // all to show: its details opened empty. Its names are what it has.
    const ref = this.referenceEntity();
    const names = ref.name;
    if (
      !this.displayReference() &&
      ref.moleculeType === MoleculeType.ENTITY &&
      names?.length &&
      !('geneName' in ref && ref.geneName.length)
    ) {
      return [{ label: 'Name', value: names.join(', ') }, ...rows];
    }
    return rows;
  });

  readonly moleculeType = computed(() => {
    // The structure viewer takes null for none.
    return this.referenceEntity().moleculeType ?? null;
  });

  readonly hasStructure = computed(() =>
    [MoleculeType.CHEMICAL, MoleculeType.CHEMICAL_DRUG, MoleculeType.PROTEIN].includes(
      this.moleculeType() as MoleculeType
    )
  );

  /** A row's value as text: a list of names with ", " ("TP53, P53"), not the bare commas of a list printed as it is. */
  protected asText(value: unknown): string {
    return Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '');
  }

  protected readonly isString = isString;
  protected readonly isArray = isArray;

  /** The id "Select summary of entity" selects; null hides the button. */
  readonly summaryId = computed(() => summarySelection(this.referenceEntity()));

  onSelect(id: string) {
    this.state.select.set(id);
  }

  protected readonly Labels = Labels;
}
