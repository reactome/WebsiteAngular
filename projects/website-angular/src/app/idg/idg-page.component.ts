import {
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOptgroup, MatOption, MatSelect } from '@angular/material/select';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { IdgDataset, IdgPathway, IdgService } from './idg.service';

/**
 * The dataset to start from: human protein interactions, pooled across BioGrid,
 * BioPlex and StringDB. It is the one nearly every question about a human
 * protein starts with, and the 100-odd others are variations on species and
 * assay that a person can then choose deliberately.
 */
const DEFAULT_DATASET = 'BioGridBioPlexStringDB|Homo_sapiens|Protein_Interaction';

/**
 * "What does this protein have to do with Reactome?"
 *
 * A port of the search on idg.reactome.org, which talks to the same service this
 * page does -- the data has not moved and does not need to for the page to work.
 *
 * The pathways it finds are ours, so the results link into our own pathway
 * browser rather than carrying the IDG portal's diagram widgets across. That was
 * the main reason to port the front end rather than embed the old page.
 */
@Component({
  selector: 'app-idg-page',
  imports: [
    PageLayoutComponent,
    FormsModule,
    RouterLink,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatHint,
    MatIcon,
    MatInput,
    MatOptgroup,
    MatOption,
    MatSelect,
    MatProgressSpinner,
  ],
  templateUrl: './idg-page.component.html',
  styleUrl: './idg-page.component.scss',
})
export class IdgPageComponent {
  private idg = inject(IdgService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** What is in the box, which is not yet what has been searched for. */
  readonly entered = signal(this.route.snapshot.queryParamMap.get('gene') ?? '');

  /**
   * The searched term, in the URL so a result can be sent to someone.
   */
  readonly term = signal(this.route.snapshot.queryParamMap.get('gene') ?? '');

  readonly datasets = rxResource({ stream: () => this.idg.datasets() });

  /**
   * The chosen datasets, defaulting once the list arrives.
   *
   * linkedSignal rather than an effect writing a signal: the default depends on
   * the loaded list, and a person's choice has to survive the list being
   * re-read.
   */
  readonly selected = linkedSignal<IdgDataset[] | undefined, number[]>({
    // hasValue() first: reading value() on a resource that failed throws, and a
    // throw inside a computed the template depends on takes the whole page down
    // with it -- which is how a failing IDG server produced "nothing found"
    // instead of "the service did not answer".
    source: () => (this.datasets.hasValue() ? this.datasets.value() : undefined),
    computation: (available, previous) => {
      if (previous?.value?.length) return previous.value;
      const fallback = available?.find((dataset) => dataset.id === DEFAULT_DATASET);
      return fallback ? [fallback.digitalKey] : [];
    },
  });

  /** Datasets grouped by species, which is how a person narrows this down. */
  readonly bySpecies = computed(() => {
    const groups = new Map<string, IdgDataset[]>();
    for (const dataset of (this.datasets.hasValue() ? this.datasets.value() : []) ?? []) {
      const species = (dataset.bioSource ?? 'Other').replace(/_/g, ' ');
      groups.set(species, [...(groups.get(species) ?? []), dataset]);
    }
    // Human first: it is what most people are here for.
    return [...groups.entries()].sort(([a], [b]) =>
      a === 'Homo sapiens' ? -1 : b === 'Homo sapiens' ? 1 : a.localeCompare(b)
    );
  });

  readonly results = rxResource({
    params: () => {
      const term = this.term().trim();
      const keys = this.selected();
      return term && keys.length ? { term, keys } : undefined;
    },
    stream: ({ params }) => this.idg.enrichedPathways(params.term, params.keys),
  });

  /**
   * Whether the service knows the term at all.
   *
   * Only interesting when nothing came back: "we have never heard of this
   * symbol" and "this protein has no enriched pathway in the datasets you
   * picked" are different answers, and telling them apart is the difference
   * between checking your spelling and choosing more datasets.
   */
  readonly known = rxResource({
    params: () => {
      const term = this.term().trim();
      return term ? { term } : undefined;
    },
    stream: ({ params }) => this.idg.checkTerm(params.term),
  });

  /** Leaf pathways only: a hit there is more specific than one on a top-level. */
  readonly leavesOnly = signal(false);

  readonly pathways = computed<IdgPathway[]>(() => {
    const found = (this.results.hasValue() ? this.results.value() : []) ?? [];
    return this.leavesOnly() ? found.filter((pathway) => pathway.bottomLevel) : found;
  });

  /**
   * Whether the service is the problem.
   *
   * The dataset list counts, not just the query. With the IDG server
   * unreachable, the list is what fails first -- and with no datasets nothing is
   * selected, so the query never runs and never errors. The page then had a
   * search box, no datasets, and "nothing found", which blames the gene for the
   * server being down.
   */
  readonly failed = computed(
    () => this.datasets.status() === 'error' || this.results.status() === 'error'
  );

  constructor() {
    // Keep the box and the URL in step when someone navigates back, or edits the
    // address directly.
    effect(() => {
      const gene = this.route.snapshot.queryParamMap.get('gene') ?? '';
      if (gene !== untracked(this.term)) {
        this.entered.set(gene);
        this.term.set(gene);
      }
    });
  }

  search() {
    const gene = this.entered().trim();
    this.term.set(gene);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { gene: gene || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Both resources, since either can be the one that failed. */
  retry() {
    if (this.datasets.status() === 'error') this.datasets.reload();
    if (this.results.status() === 'error') this.results.reload();
  }

  /** A dataset's label: provenance and assay, species being the group heading. */
  label(dataset: IdgDataset) {
    return `${dataset.provenance} — ${dataset.dataType.replace(/_/g, ' ')}`;
  }

  /** The datasets currently chosen, for the attribution line. */
  readonly chosen = computed(() => {
    const keys = new Set(this.selected());
    const available = this.datasets.hasValue() ? this.datasets.value() : [];
    return (available ?? []).filter((dataset) => keys.has(dataset.digitalKey));
  });

  format(value: number) {
    if (value === 0) return '0';
    return value < 0.001 ? value.toExponential(2) : value.toFixed(4);
  }
}
