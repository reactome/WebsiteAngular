import {Component, effect, inject, input, signal} from '@angular/core';
import {NgTemplateOutlet} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {MatIcon} from '@angular/material/icon';
import {CONTENT_SERVICE} from '../../../../../../pathway-browser/src/environments/environment';
import {IconService} from '../../../../../../pathway-browser/src/app/services/icon.service';

export interface PathwayBrowserNode {
  stId: string;
  name: string;
  species: string;
  url: string;
  type: string;
  diagram: boolean;
  children?: PathwayBrowserNode[];
}

@Component({
  selector: 'app-locations-tree',
  standalone: true,
  imports: [NgTemplateOutlet, MatIcon],
  templateUrl: './locations-tree.component.html',
  styleUrl: './locations-tree.component.scss',
})
export class LocationsTreeComponent {
  private http = inject(HttpClient);
  private iconService = inject(IconService);

  id = input.required<string>();
  trees = signal<PathwayBrowserNode[]>([]);
  expanded = signal<Set<string>>(new Set());
  allExpanded = signal(false);
  loading = signal(false);

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.fetchLocations(id);
    });
  }

  private fetchLocations(id: string) {
    this.loading.set(true);
    const url = `${CONTENT_SERVICE}/data/detail/${id}/locationsInPWB`;
    this.http.get<PathwayBrowserNode[]>(url).subscribe({
      next: (data) => {
        this.trees.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.trees.set([]);
        this.loading.set(false);
      },
    });
  }

  toggleNode(key: string) {
    const current = new Set(this.expanded());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.expanded.set(current);
  }

  toggleAll() {
    if (this.allExpanded()) {
      this.expanded.set(new Set());
      this.allExpanded.set(false);
    } else {
      const all = new Set<string>();
      const collect = (nodes: PathwayBrowserNode[]) => {
        for (const node of nodes) {
          all.add(this.nodeKey(node));
          if (node.children?.length) collect(node.children);
        }
      };
      collect(this.trees());
      this.expanded.set(all);
      this.allExpanded.set(true);
    }
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  hasChildren(node: PathwayBrowserNode): boolean {
    return !!node.children?.length;
  }

  getIconName(type: string): string {
    const icons = this.iconService.getReactomeSubjectIcons();
    return icons[type]?.name ?? 'pathway';
  }

  nodeKey(node: PathwayBrowserNode): string {
    return node.url || node.stId;
  }
}
