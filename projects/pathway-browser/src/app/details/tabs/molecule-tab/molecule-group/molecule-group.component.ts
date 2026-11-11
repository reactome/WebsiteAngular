import { Component, computed, input, linkedSignal } from '@angular/core';
import type { MoleculeGroup } from '../molecule-tab.component';
import { ObjectTreeComponent } from '../../../common/object-tree/object-tree.component';
import { MatPaginator, PageEvent } from '@angular/material/paginator';

@Component({
  selector: 'cr-molecule-group',
  imports: [ObjectTreeComponent, MatPaginator, MatPaginator],
  templateUrl: './molecule-group.component.html',
  styleUrl: './molecule-group.component.scss',
})
export class MoleculeGroupComponent {
  readonly group = input.required<MoleculeGroup>();
  readonly pageSize = input<number>(50);
  /**
   * The page shown: the first again whenever the list changes (FR-046). It was
   * kept, so turning to the selection's 164 proteins from page 7 of 345 showed
   * "301 - 350 of 164" and nothing under it.
   */
  readonly currentPage = linkedSignal<MoleculeGroup, PageEvent>({
    source: this.group,
    computation: () => ({ pageIndex: 0, pageSize: this.pageSize(), length: 0 }),
  });

  /**
   * Highlighted first, then by how many of the pathway's participants hold the
   * molecule (the "N x" shown), then by name (FR-045). On a copy: sorting the
   * group's own array reordered what the download writes.
   */
  readonly sortedData = computed(() =>
    [...this.group().data].sort(
      (a, b) =>
        +b.highlight - +a.highlight ||
        b.stoichiometry - a.stoichiometry ||
        a.entity.formattedName.localeCompare(b.entity.formattedName)
    )
  );

  readonly hasPagination = computed(() => this.sortedData().length > this.pageSize());
  readonly pagedData = computed(() =>
    this.hasPagination()
      ? this.sortedData().slice(
          this.currentPage().pageIndex * this.currentPage().pageSize,
          (this.currentPage().pageIndex + 1) * this.currentPage().pageSize
        )
      : this.sortedData()
  );

  sanitizeId(label: string): string {
    return label
      .toLowerCase()
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/[^a-z0-9-_]/g, ''); // Remove special characters
  }

  getStatistics(graph: MoleculeGroup) {
    const found = graph.found;
    const total = graph.data.length;
    // In words (FR-041): "8 / 20" did not say which number was which.
    // Undefined while nothing inside the pathway is selected: no highlighting.
    if (found === undefined) return `${total}`;
    return `${total} · ${found || 'none'} highlighted`;
  }
}
