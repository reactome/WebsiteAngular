import { Component, computed, effect, input } from '@angular/core';
import {
  MatNestedTreeNode,
  MatTree,
  MatTreeNestedDataSource,
  MatTreeNodeDef,
  MatTreeNodeOutlet,
  MatTreeNodeToggle,
} from '@angular/material/tree';
import { sortByYearDescending } from '../../../services/utils';
import { Publication } from '../../../model/graph/publication/publication.model';
import { PublicationComponent } from '../publication/publication.component';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';

/**
 * What holds references: a summation, a catalyst's or a regulation's
 * reference. A summation's list is left out of the flat view, and the
 * callers pass a holder only when its list has entries.
 */
type ReferenceHolder = { literatureReference?: Publication[] };

/**
 * A node in the tree: either the holder at the root or one of its references.
 *
 * The accessor used to claim it returned ReferenceHolder[] while actually
 * returning the references, which are not holders -- a real type error that a
 * //@ts-ignore hid. The suppression only covered the line directly beneath it,
 * so it stopped working the moment the expression was wrapped onto two lines.
 */
type ReferenceNode = ReferenceHolder | Publication;

const hasReferences = (node: ReferenceNode): node is ReferenceHolder =>
  'literatureReference' in node && Array.isArray(node.literatureReference);

@Component({
  selector: 'cr-refs-tree',
  templateUrl: './refs-tree.html',
  imports: [
    MatTree,
    MatNestedTreeNode,
    PublicationComponent,
    MatIcon,
    MatTreeNodeOutlet,
    MatButton,
    MatTreeNodeToggle,
    MatTreeNodeDef,
  ],
  styleUrl: './refs-tree.scss',
})
export class RefsTreeComponent {
  readonly referenceHolder = input.required<ReferenceHolder, ReferenceHolder>({
    transform: (holder: ReferenceHolder) => {
      if (holder.literatureReference)
        holder.literatureReference = sortByYearDescending(holder.literatureReference);
      return holder;
    },
  });
  readonly title = computed(
    () => `${this.referenceHolder().literatureReference?.length ?? 0} references`
  );

  dataSource = new MatTreeNestedDataSource<ReferenceNode>();

  constructor() {
    effect(() => (this.dataSource.data = [this.referenceHolder()]));
  }

  childrenAccessor = (node: ReferenceNode): ReferenceNode[] =>
    hasReferences(node) ? (node.literatureReference ?? []) : [];

  hasChild = (_: number, node: ReferenceNode) =>
    hasReferences(node) && (node.literatureReference?.length ?? 0) > 0;
}
