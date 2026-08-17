import { Component, computed, input, inject } from '@angular/core';
import {EntityService} from "../../../services/entity.service";
import {DatabaseIdentifier} from "../../../model/graph/database-identifier.model";
import {KeyValuePipe} from "@angular/common";
import {SortByTextPipe} from "../../../pipes/sort-by-text.pipe";

@Component({
  selector: 'cr-cross-references',
  templateUrl: './cross-references.component.html',
  imports: [
    KeyValuePipe,
    SortByTextPipe
  ],
  styleUrl: './cross-references.component.scss'
})
export class CrossReferencesComponent {
  private entity = inject(EntityService);

  readonly _crossReferences = input.required<DatabaseIdentifier[]>({alias: 'crossRefs'});

  readonly crossReferences = computed(() => {

    if (this._crossReferences().length == 0) return new Map<string, DatabaseIdentifier[]>();
    const crossRefs = [...this._crossReferences()];
    const grouped = this.entity.getGroupedData(crossRefs, ref => ref.databaseName);
    // Sort the identifiers within each database group so e.g. RefSeq IDs
    // come out in stable, human-friendly order. numeric: true keeps
    // "NM_000546.5" before "NM_000546.10" instead of lexicographic.
    for (const list of grouped.values()) {
      list.sort((a, b) =>
        a.identifier.localeCompare(b.identifier, undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    return grouped;
  });
}
