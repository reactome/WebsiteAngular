import { Component, computed, input } from '@angular/core';
import { EntityWithAccessionedSequence } from '../../../model/graph/physical-entity/entity-with-accessioned-sequence.model';
import { DataKeys, SchemaClasses } from '../../../constants/constants';
import { MarkerReference } from '../../../model/graph/control-reference/marker-reference.model';
import { ObjectTreeComponent } from '../object-tree/object-tree.component';
import { RefsTreeComponent } from '../refs-tree/refs-tree.component';

@Component({
  selector: 'cr-cell-marker',
  templateUrl: './cell-marker.component.html',
  styleUrl: './cell-marker.component.scss',
  standalone: true,
  imports: [ObjectTreeComponent, RefsTreeComponent],
})
export class CellMarkerComponent {
  readonly proteinMarkers = input.required<EntityWithAccessionedSequence[]>();
  readonly rnaMarkers = input.required<EntityWithAccessionedSequence[]>();
  readonly markerRefs = input.required<MarkerReference[]>();

  constructor() {}

  readonly refs = computed(() => {
    const map = new Map<number, MarkerReference>();
    // Every marker reference names its marker (557 of 557 sampled).
    for (const ref of this.markerRefs()) map.set(ref.marker.dbId, ref);
    return map;
  });

  protected readonly SchemaClasses = SchemaClasses;
  protected readonly DataKeys = DataKeys;
}
