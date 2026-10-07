import { Component, computed, input, output, signal } from '@angular/core';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import type cytoscape from 'cytoscape';

/** One name drawn in the diagram, and every element drawn under that name. */
export interface DiagramSearchTarget {
  name: string;
  /** What kind of thing it is -- Protein, Reaction, Subpathway... -- shown beside the name. */
  kind: string;
  elements: cytoscape.Collection;
}

/** More than this and the list stops being something anyone reads. */
const MAX_OPTIONS = 50;

/**
 * Find something in the diagram by the name it is drawn with.
 *
 * The names are collected when the box gains focus rather than once at load:
 * opening interactors adds nodes, and switching pathway replaces the graph,
 * and either would otherwise leave the list describing a diagram that is no
 * longer on screen.
 */
@Component({
  selector: 'cr-diagram-search',
  templateUrl: './diagram-search.component.html',
  styleUrls: ['./diagram-search.component.scss'],
  standalone: true,
  imports: [MatAutocomplete, MatAutocompleteTrigger, MatOption, MatIcon, MatIconButton, MatTooltip],
})
export class DiagramSearchComponent {
  /** Reads the names off the diagram as it currently is. */
  readonly collect = input.required<() => DiagramSearchTarget[]>();

  readonly picked = output<DiagramSearchTarget>();
  readonly cleared = output<void>();

  readonly targets = signal<DiagramSearchTarget[]>([]);
  readonly query = signal('');

  readonly options = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return [];

    // Names that start with the query first, then names with a word that
    // does, then anything containing it -- typing "atp" should offer ATP
    // before it offers every complex with ATP somewhere in its name.
    const rank = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith(query)) return 0;
      if (new RegExp(`\\b${escapeRegExp(query)}`).test(lower)) return 1;
      return lower.includes(query) ? 2 : -1;
    };

    return this.targets()
      .map((target) => ({ target, rank: rank(target.name) }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.target.name.localeCompare(b.target.name))
      .slice(0, MAX_OPTIONS)
      .map(({ target }) => target);
  });

  refresh() {
    this.targets.set(this.collect()());
  }

  onInput(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onSelected(event: MatAutocompleteSelectedEvent) {
    const target = event.option.value as DiagramSearchTarget;
    this.query.set(target.name);
    this.picked.emit(target);
  }

  clear(input: HTMLInputElement) {
    input.value = '';
    this.query.set('');
    this.cleared.emit();
  }

  displayName = (target: DiagramSearchTarget | string | null) =>
    typeof target === 'string' ? target : (target?.name ?? '');
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
