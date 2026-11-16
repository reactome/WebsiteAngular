import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { CONTENT_SERVICE } from '../../../../../../pathway-browser/src/environments/environment';
import { IconService } from '../../../../../../pathway-browser/src/app/services/icon.service';
import { PathwayBrowserNode } from '../../../../model/locations.model';

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

  readonly id = input.required<string>();
  /**
   * Content pages show a short tree open (spec 023, FR-050): closed, it showed
   * only its top-level pathways, and every reader had to open it to reach the
   * one thing the section is for. The Pathway Browser's details keep it closed
   * (FR-053): the reader is already in a pathway there, in a narrow panel.
   */
  readonly openByDefault = input(false);
  readonly trees = signal<PathwayBrowserNode[]>([]);
  readonly expanded = signal<Set<string>>(new Set());
  readonly loading = signal(false);
  readonly selectedSpecies = signal<string | null>(null);

  readonly availableSpecies = computed(() => {
    const species = new Set<string>();
    for (const tree of this.trees()) {
      if (tree.species) species.add(tree.species);
    }
    return [...species].sort();
  });

  readonly filteredTrees = computed(() => {
    const selected = this.selectedSpecies();
    const all = this.trees();
    if (!selected || this.availableSpecies().length <= 1) return all;
    return all.filter((t) => t.species === selected);
  });

  /** Every top-level pathway with something under it is open: the button then collapses. */
  readonly allExpanded = computed(() => {
    const expandable = this.filteredTrees().filter((tree) => this.hasChildren(tree));
    return expandable.length > 0 && expandable.every((tree) => this.expanded().has(tree.stId));
  });

  /** Each top-level pathway's number of locations, counted once per tree, not per redraw. */
  readonly countsByRoot = computed(
    () => new Map(this.filteredTrees().map((tree) => [tree.stId, countLocations(tree)]))
  );

  /** How many locations the species shown has: the places, not the path to them. */
  readonly locationCount = computed(() =>
    [...this.countsByRoot().values()].reduce((sum, n) => sum + n, 0)
  );

  /** Whether any top-level pathway has something to open: if none, "Expand all" has nothing to do. */
  readonly anyExpandable = computed(() =>
    this.filteredTrees().some((tree) => this.hasChildren(tree))
  );

  /**
   * Whether each top-level pathway says how many locations it holds: on a
   * content page, for a tree too long to show open (FR-051). The Pathway
   * Browser's details stay as they were (FR-053).
   */
  readonly showCounts = computed(() => this.openByDefault() && !this.shownOpen());

  /**
   * Whether this tree was opened for the reader: short enough to show whole
   * (FR-050), so shown without the scrolling box a long subtree needs.
   */
  readonly shownOpen = computed(() => this.openByDefault() && opensWhole(this.locationCount()));

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.fetchLocations(id);
    });
  }

  private fetchLocations(id: string) {
    this.loading.set(true);
    this.expanded.set(new Set());
    this.selectedSpecies.set(null);
    const url = `${CONTENT_SERVICE}/data/detail/${id}/locationsInPWB`;
    this.http.get<PathwayBrowserNode[]>(url).subscribe({
      next: (answer) => {
        const data = answer.map(withBrowserLinks);
        this.trees.set(data);
        const species = new Set<string>();
        for (const tree of data) {
          if (tree.species) species.add(tree.species);
        }
        if (species.has('Homo sapiens')) {
          this.selectedSpecies.set('Homo sapiens');
        } else {
          const first = [...species].sort()[0];
          if (first) this.selectedSpecies.set(first);
        }
        this.openIfShort();
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
    } else {
      this.expanded.set(new Set(this.filteredTrees().map((tree) => tree.stId)));
    }
  }

  /** FR-050: on a content page, a short tree opens whole, on load and on a change of species. */
  private openIfShort() {
    if (this.shownOpen()) this.expanded.set(new Set(this.filteredTrees().map((tree) => tree.stId)));
  }

  /** The number of locations under a top-level pathway, shown on a content page when the tree is too long to open (FR-051). */
  locationsUnder(tree: PathwayBrowserNode): number {
    return this.countsByRoot().get(tree.stId) ?? 0;
  }

  isExpanded(stId: string): boolean {
    return this.expanded().has(stId);
  }

  readonly linksOut = linksOut;

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
    this.openIfShort();
  }

  isLastChild(parent: PathwayBrowserNode[], node: PathwayBrowserNode): boolean {
    return parent[parent.length - 1] === node;
  }
}

/** The reaction classes, whose place in a tree is a link, as on reactome.org. */
const REACTION_TYPES = new Set([
  'Reaction',
  'BlackBoxEvent',
  'Polymerisation',
  'Depolymerisation',
  'FailedReaction',
]);

/**
 * Whether a node of the tree links into the Pathway Browser: its end -- the
 * object the page is about -- and any reaction on the way, which opens its
 * diagram with the reaction selected (#443). Pathways, complexes and sets on
 * the way are only the path, as reactome.org's tree has them.
 */
export function linksOut(node: PathwayBrowserNode): boolean {
  return !!node.url && (!node.children?.length || REACTION_TYPES.has(node.type));
}

/**
 * The tree with links a browser can follow. The content service writes each
 * node's address for the old site, which put it into HTML as it was, so its
 * ampersands are HTML-escaped: `/PathwayBrowser/#/R-HSA-163615&amp;PATH=...`.
 * Bound to an href as data, that `&amp;` stays literal, and the Pathway Browser
 * could not read the address: every location reached through a parent (any
 * pathway with more than one, such as PKA activation) opened the browser with
 * no pathway at all. The answer itself is Java's, byte for byte, and stays so.
 */
export function withBrowserLinks(node: PathwayBrowserNode): PathwayBrowserNode {
  const linked = { ...node, url: node.url.replaceAll('&amp;', '&') };
  return node.children ? { ...linked, children: node.children.map(withBrowserLinks) } : linked;
}

/** FR-050's limit: measured on release 98, PKA activation has 2, a reaction 3, BCL2 16, ATP 2,182 (Homo sapiens). */
const OPEN_AT_MOST = 20;

/** Whether a tree with this many locations is shown open on a content page (FR-050). */
export function opensWhole(locations: number): boolean {
  return locations <= OPEN_AT_MOST;
}

/** The places under a node: its leaves, each a link into the Pathway Browser. */
export function countLocations(node: PathwayBrowserNode): number {
  return node.children?.length
    ? node.children.reduce((sum, child) => sum + countLocations(child), 0)
    : 1;
}
