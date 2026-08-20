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
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOptgroup, MatOption, MatSelect } from '@angular/material/select';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { IdgDataset, IdgPathway, IdgService } from './idg.service';

/**
 * The dataset to start from in dataset mode: human protein interactions, pooled
 * across BioGrid, BioPlex and StringDB.
 */
const DEFAULT_DATASET = 'BioGridBioPlexStringDB|Homo_sapiens|Protein_Interaction';

/** Buckets in the score histogram. Enough to show shape, few enough to read. */
const BUCKETS = 28;

/** Rows shown before asking whether you really want all of them. */
const PAGE = 100;

/**
 * "What does this protein have to do with Reactome?"
 *
 * A port of the search on idg.reactome.org, which talks to the same service this
 * page does -- the data has not moved and does not need to for the page to work.
 *
 * The pathways it finds are ours, so results link into our own pathway browser,
 * and the interactors can be run as a Reactome analysis to colour the genome-wide
 * map. That was the point of porting the front end rather than embedding the old
 * page: the old one carries GWT diagram widgets that this year's work replaced.
 */
@Component({
  selector: 'app-idg-page',
  imports: [
    PageLayoutComponent,
    FormsModule,
    RouterLink,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatCheckbox,
    MatFormField,
    MatHint,
    MatLabel,
    MatIcon,
    MatInput,
    MatOptgroup,
    MatOption,
    MatSelect,
    MatProgressSpinner,
    MatSlider,
    MatSliderThumb,
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

  /** The searched term, in the URL so a result can be sent to someone. */
  readonly term = signal(this.route.snapshot.queryParamMap.get('gene') ?? '');

  /**
   * How to choose which interactors count.
   *
   * The service decides between these by whether datasets are named, and the two
   * are genuinely different questions -- "who does this protein interact with,
   * according to BioGrid" against "who is it predicted to interact with, above
   * this confidence". Score is the default because it is the one with a control
   * on it, and because the original portal leads with it.
   */
  readonly mode = signal<'score' | 'datasets'>('score');

  readonly datasets = rxResource({ stream: () => this.idg.datasets() });

  readonly selected = linkedSignal<IdgDataset[] | undefined, number[]>({
    // hasValue() first: reading value() on a resource that failed throws, and a
    // throw inside a computed the template depends on takes the render with it.
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
    return [...groups.entries()].sort(([a], [b]) =>
      a === 'Homo sapiens' ? -1 : b === 'Homo sapiens' ? 1 : a.localeCompare(b)
    );
  });

  /** Every interactor and its score, which is what the threshold acts on. */
  readonly scores = rxResource({
    params: () => {
      const term = this.term().trim();
      return term ? { term } : undefined;
    },
    stream: ({ params }) => this.idg.interactorScores(params.term),
  });

  private readonly sortedScores = computed(() => {
    const scores = this.scores.hasValue() ? this.scores.value() : undefined;
    return Object.values(scores ?? {}).sort((a, b) => a - b);
  });

  /**
   * Where the threshold can usefully sit, which is a property of the gene.
   *
   * A fixed default is wrong here: the service's own default is 0.9, and TANC1's
   * best predicted interactor scores 0.891, so 0.9 silently returns nothing at
   * all. The range comes from the data instead.
   */
  readonly scoreRange = computed(() => {
    const sorted = this.sortedScores();
    if (!sorted.length) return undefined;
    return { min: sorted[0], max: sorted[sorted.length - 1] };
  });

  /** Starts at the 90th percentile: the confident tail, without being empty. */
  readonly threshold = linkedSignal<number[] | undefined, number>({
    source: () => (this.sortedScores().length ? this.sortedScores() : undefined),
    computation: (sorted, previous) => {
      if (previous?.value !== undefined && previous.source) return previous.value;
      if (!sorted?.length) return 0.5;
      return Math.round(sorted[Math.floor(sorted.length * 0.9)] * 100) / 100;
    },
  });

  /** The interactors the threshold keeps, and how many there were to begin with. */
  readonly kept = computed(() => {
    const scores = this.scores.hasValue() ? this.scores.value() : undefined;
    const cutoff = this.threshold();
    const genes = Object.entries(scores ?? {})
      .filter(([, score]) => score >= cutoff)
      .map(([gene]) => gene);
    return { genes, total: Object.keys(scores ?? {}).length };
  });

  /** The score distribution, so the threshold is chosen against something. */
  readonly histogram = computed(() => {
    const sorted = this.sortedScores();
    const range = this.scoreRange();
    if (!sorted.length || !range) return [];
    const width = (range.max - range.min) / BUCKETS || 1;
    const counts = new Array<number>(BUCKETS).fill(0);
    for (const score of sorted) {
      const bucket = Math.min(BUCKETS - 1, Math.floor((score - range.min) / width));
      counts[bucket]++;
    }
    const tallest = Math.max(...counts, 1);
    return counts.map((count, index) => ({
      count,
      height: (count / tallest) * 100,
      from: range.min + index * width,
      kept: range.min + (index + 0.5) * width >= this.threshold(),
    }));
  });

  readonly results = rxResource({
    params: () => {
      const term = this.term().trim();
      if (!term) return undefined;
      if (this.mode() === 'datasets') {
        const datasets = this.selected();
        return datasets.length ? { term, datasets } : undefined;
      }
      // Waiting for the scores means the threshold is the data's, not a guess.
      return this.scores.hasValue() ? { term, score: this.threshold() } : undefined;
    },
    stream: ({ params }) =>
      this.idg.enrichedPathways(params.term, {
        datasets: 'datasets' in params ? params.datasets : undefined,
        score: 'score' in params ? params.score : undefined,
      }),
  });

  /**
   * Whether the service knows the term at all.
   *
   * Only interesting when nothing came back: "never heard of this symbol" and
   * "no enriched pathway at this threshold" call for different next steps.
   */
  readonly known = rxResource({
    params: () => {
      const term = this.term().trim();
      return term ? { term } : undefined;
    },
    stream: ({ params }) => this.idg.checkTerm(params.term),
  });

  /** Default to the specific and the significant, which is the readable answer. */
  readonly leavesOnly = signal(true);
  readonly significantOnly = signal(true);
  readonly showAll = signal(false);

  private readonly matching = computed<IdgPathway[]>(() => {
    const found = (this.results.hasValue() ? this.results.value() : []) ?? [];
    return found.filter(
      (pathway) =>
        (!this.leavesOnly() || pathway.bottomLevel) &&
        (!this.significantOnly() || pathway.fdr <= 0.05)
    );
  });

  readonly pathways = computed(() =>
    this.showAll() ? this.matching() : this.matching().slice(0, PAGE)
  );

  readonly counts = computed(() => ({
    shown: this.pathways().length,
    matching: this.matching().length,
    total: ((this.results.hasValue() ? this.results.value() : []) ?? []).length,
  }));

  readonly pageSize = PAGE;

  /**
   * Whether the service is the problem.
   *
   * The dataset list counts, not just the query: with the IDG server unreachable
   * the list fails first, nothing is selected, so the query never runs and never
   * errors. The page then showed "nothing found", which blames the gene for the
   * server being down.
   */
  readonly failed = computed(
    () =>
      this.datasets.status() === 'error' ||
      this.results.status() === 'error' ||
      this.scores.status() === 'error'
  );

  /** Set while an analysis is being created, since that takes a moment. */
  readonly analysing = signal(false);
  readonly analysisFailed = signal(false);

  constructor() {
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
    this.showAll.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { gene: gene || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Send the kept interactors through Reactome's own analysis and open the
   * genome-wide view on the result.
   *
   * This is not IDG's enrichment recomputed -- it is Reactome's
   * overrepresentation of the interactor list -- which is why the button says
   * what it does and the page says so next to it. What it buys is every existing
   * overlay: Reacfoam coloured by significance, the diagrams, the results table.
   */
  async overlay() {
    const genes = this.kept().genes;
    if (!genes.length) return;
    this.analysing.set(true);
    this.analysisFailed.set(false);
    try {
      const token = await new Promise<string | undefined>((resolve, reject) =>
        this.idg.analyseInteractors(this.term(), genes).subscribe({ next: resolve, error: reject })
      );
      if (!token) throw new Error('no token');
      await this.router.navigate(['/PathwayBrowser'], { queryParams: { analysis: token } });
    } catch {
      this.analysisFailed.set(true);
    } finally {
      this.analysing.set(false);
    }
  }

  retry() {
    if (this.datasets.status() === 'error') this.datasets.reload();
    if (this.scores.status() === 'error') this.scores.reload();
    if (this.results.status() === 'error') this.results.reload();
  }

  /** A dataset's label: provenance and assay, species being the group heading. */
  label(dataset: IdgDataset) {
    return `${dataset.provenance} — ${dataset.dataType.replace(/_/g, ' ')}`;
  }

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
