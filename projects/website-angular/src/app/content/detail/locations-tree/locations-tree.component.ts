import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { CONTENT_SERVICE } from '../../../../../../pathway-browser/src/environments/environment';
import { IconService } from '../../../../../../pathway-browser/src/app/services/icon.service';

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
  selectedSpecies = signal<string | null>(null);

  availableSpecies = computed(() => {
    const species = new Set<string>();
    for (const tree of this.trees()) {
      if (tree.species) species.add(tree.species);
    }
    return [...species].sort();
  });

  filteredTrees = computed(() => {
    const selected = this.selectedSpecies();
    const all = this.trees();
    if (!selected || this.availableSpecies().length <= 1) return all;
    return all.filter((t) => t.species === selected);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.fetchLocations(id);
    });
  }

  private fetchLocations(id: string) {
    this.loading.set(true);
    this.expanded.set(new Set());
    this.allExpanded.set(false);
    this.selectedSpecies.set(null);
    const url = `${CONTENT_SERVICE}/data/detail/${id}/locationsInPWB`;
    this.http.get<PathwayBrowserNode[]>(url).subscribe({
      next: (data) => {
        this.trees.set(data);
        const species = new Set<string>();
        for (const tree of data) {
          if (tree.species) species.add(tree.species);
        }
        if (species.has('Homo sapiens')) {
          this.selectedSpecies.set('Homo sapiens');
        } else if (species.size > 0) {
          this.selectedSpecies.set([...species].sort()[0]);
        }
        this.loading.set(false);
      },
      error: () => {
        this.trees.set([]);
        this.loading.set(false);
      },
    });
  }

  toggleRoot(stId: string) {
    const current = new Set(this.expanded());
    if (current.has(stId)) {
      current.delete(stId);
    } else {
      current.add(stId);
    }
    this.expanded.set(current);
  }

  toggleAll() {
    if (this.allExpanded()) {
      this.expanded.set(new Set());
      this.allExpanded.set(false);
    } else {
      const all = new Set<string>();
      for (const tree of this.filteredTrees()) {
        all.add(tree.stId);
      }
      this.expanded.set(all);
      this.allExpanded.set(true);
    }
  }

  isExpanded(stId: string): boolean {
    return this.expanded().has(stId);
  }

  hasChildren(node: PathwayBrowserNode): boolean {
    return !!node.children?.length;
  }

  getIconName(type: string): string {
    const icons = this.iconService.getReactomeSubjectIcons();
    return icons[type]?.name ?? 'pathway';
  }

  onSpeciesChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedSpecies.set(value);
    this.expanded.set(new Set());
    this.allExpanded.set(false);
  }

  isLastChild(parent: PathwayBrowserNode[], node: PathwayBrowserNode): boolean {
    return parent[parent.length - 1] === node;
  }
}
