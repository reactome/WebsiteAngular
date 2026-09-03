import { Component, computed, input } from '@angular/core';
import { CustomInteraction } from '../../../interactors/model/interactor.model';
import { CONTENT_QUERY } from '../../../../environments/environment';
import {
  MatTable,
  MatColumnDef,
  MatHeaderCell,
  MatCell,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRow,
  MatRow,
  MatHeaderRowDef,
  MatRowDef,
} from '@angular/material/table';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'cr-interactors-table',
  templateUrl: './interactors-table.component.html',
  styleUrl: './interactors-table.component.scss',
  standalone: true,
  imports: [
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRow,
    MatRow,
    MatHeaderRowDef,
    MatRowDef,
    MatAnchor,
    MatIcon,
    MatTooltip,
    DecimalPipe,
  ],
})
export class InteractorsTableComponent {
  readonly _interactors = input.required<CustomInteraction[]>({ alias: 'interactors' });

  interactors = computed(() => {
    const interactors = this._interactors();
    return interactors.map((interactor) => ({
      ...interactor,
      finalGeneName: interactor.geneName?.[0] || interactor.variantIdentifier,
      formattedIdentifier: `${interactor.databaseName}:${interactor.identifier}`,
    }));
  });

  // displayedColumns: string[] = Object.keys(this.interactors()[0] || {});
  displayedColumns = [
    'geneName',
    'identifier',
    'speciesName',
    'entitiesCount',
    'evidenceCount',
    'score',
  ];

  protected readonly CONTENT_QUERY = CONTENT_QUERY;
}
