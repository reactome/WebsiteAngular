import { Component, computed, input, linkedSignal, Signal, signal } from '@angular/core';
import { DatabaseObject } from '../../../model/graph/database-object.model';
import { PageEvent } from '@angular/material/paginator';
import { isArray, max } from 'lodash';
import { InDepth } from '../../../model/graph/in-depth.model';
import type { Relationship } from '../../../model/graph/relationship.model';
import { MatPaginator } from '@angular/material/paginator';
import { ObjectTreeComponent } from '../object-tree/object-tree.component';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { GaEventDirective } from '@hakimio/ngx-google-analytics';

@Component({
  selector: 'cr-controller-tree',
  templateUrl: './controller-tree.component.html',
  styleUrl: './controller-tree.component.scss',
  standalone: true,
  imports: [
    ObjectTreeComponent,
    MatTooltip,
    MatIcon,
    MatIconButton,
    MatPaginator,
    GaEventDirective,
  ],
})
export class ControllerTreeComponent<
  E extends DatabaseObject & InDepth,
  R extends Relationship.Has<E>,
> {
  readonly type = input.required<string>();
  readonly depthControl = input.required<boolean>();
  readonly data = input.required<R[], (E | R)[] | E | R>({
    transform: (data) =>
      !isArray(data)
        ? data.element
          ? [data as R]
          : [this.elementToRelationship(data as E)]
        : data.map((e, i) => (e.element ? (e as R) : this.elementToRelationship(e as E, i))),
  });

  readonly scope = input<'entity' | 'event'>('entity');
  readonly disableNavigation = input<boolean>(false);

  readonly pageSize = input(30);

  readonly depthIndex = signal(1);
  readonly depthChangeSource = signal<'controller' | 'tree' | undefined>(undefined);
  /** None when no element came from an in-depth answer. */
  readonly maxDepth = computed(() => max(this.data().map((d) => d.element.maxDepth)));

  readonly hasPagination = computed(() => this.data().length > this.pageSize());
  readonly currentPage = linkedSignal<PageEvent>(() => ({
    pageIndex: 0,
    pageSize: this.pageSize(),
    length: 0,
  }));
  readonly displayedData: Signal<R[]> = computed(() => {
    return this.hasPagination()
      ? this.data().slice(
          this.currentPage().pageIndex * this.currentPage().pageSize,
          (this.currentPage().pageIndex + 1) * this.currentPage().pageSize
        )
      : this.data();
  });

  firstPage() {
    this.depthChangeSource.set('controller');
    this.depthIndex.set(1);
  }

  previousPage() {
    if (this.depthIndex() > 1) {
      this.depthChangeSource.set('controller');
      this.depthIndex.update((d) => d - 1);
    }
  }

  nextPage() {
    const maxDepth = this.maxDepth();
    if (maxDepth !== undefined && this.depthIndex() < maxDepth) {
      this.depthChangeSource.set('controller');
      this.depthIndex.update((d) => d + 1);
    }
  }

  lastPage() {
    // With no depth to go to, there is no last page: it used to set the depth to undefined.
    const maxDepth = this.maxDepth();
    if (maxDepth === undefined) return;
    this.depthChangeSource.set('controller');
    this.depthIndex.set(maxDepth);
  }

  elementToRelationship(element: E, i = 0): R {
    return {
      type: this.type(),
      stoichiometry: 1,
      order: i,
      element: element,
      index: i,
    } as R;
  }
}
