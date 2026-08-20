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
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOptgroup, MatOption, MatSelect } from '@angular/material/select';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { IdgDataset, IdgDruggability, IdgPathway, IdgService } from './idg.service';

/** A row of the table: the pathway, plus how well studied its proteins are. */
interface IdgRow extends IdgPathway {
  tdl?: IdgDruggability;
}

/**
 * The dataset to start from in dataset mode: human protein interactions, pooled
 * across BioGrid, BioPlex and StringDB.
 */
const DEFAULT_DATASET = 'BioGridBioPlexStringDB|Homo_sapiens|Protein_Interaction';

/**
 * The service's index holds upper-case human gene symbols and nothing else.
 *
 * checkTerm says TANC1 and TP53 exist while tanc1, Tanc1 and Trp53 do not, and
 * the enrichment endpoint answers a lower-case term with zero pathways rather
 * than an error -- so a typed-as-you-speak "tanc1" looked exactly like a gene
 * with no enriched pathways. Upper-casing cannot collide with a mixed-case
 * symbol from another species, because no mixed-case symbol is in there.
 * UniProt accessions, which the service also accepts, are upper-case already.
 */
function normalise(term: string) {
  return term.trim().toUpperCase();
}

/** Buckets in the score histogram. Enough to show shape, few enough to read. */
const BUCKETS = 28;

/** Rows per page, and the portal's own default first. */
const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The portal's own starting threshold.
 *
 * Clamped down to a gene's best score when 0.8 is above it, which the portal does
 * not do: TANC1's best predicted interactor is 0.891 so 0.8 is fine there, but a
 * gene whose scores top out lower would otherwise open on an empty page and no
 * clue that the threshold is why.
 */
const DEFAULT_THRESHOLD = 0.8;

/**
 * A stable colour per top-level pathway.
 *
 * Hue from the name, so "Metabolism" is the same colour on every gene's plot and
 * nobody has to maintain a list of 28 top-level pathways in two places.
 */
function hueFor(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hash} 65% 45%)`;
}

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
    MatIconButton,
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
  readonly entered = signal(normalise(this.route.snapshot.queryParamMap.get('gene') ?? ''));

  /** The searched term, in the URL so a result can be sent to someone. */
  readonly term = signal(normalise(this.route.snapshot.queryParamMap.get('gene') ?? ''));

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
      if (!sorted?.length) return DEFAULT_THRESHOLD;
      const best = sorted[sorted.length - 1];
      return Math.min(DEFAULT_THRESHOLD, Math.round(best * 100) / 100);
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
   * Target Development Level per pathway: the druggability signal.
   *
   * Requested alongside the results rather than folded into them, because it
   * comes from a different endpoint and its absence should cost a column rather
   * than the page.
   */
  readonly druggability = rxResource({
    params: () => {
      const term = this.term().trim();
      if (!term) return undefined;
      if (this.mode() === 'datasets') {
        const datasets = this.selected();
        return datasets.length ? { term, datasets } : undefined;
      }
      return this.scores.hasValue() ? { term, score: this.threshold() } : undefined;
    },
    stream: ({ params }) =>
      this.idg.druggability(params.term, {
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

  /** Which row is open, if any. One at a time, as the portal does it. */
  readonly expanded = signal<string | null>(null);

  /** What the open row shows: the pathway's description and its ancestry. */
  readonly detail = rxResource({
    params: () => {
      const stId = this.expanded();
      return stId ? { stId } : undefined;
    },
    stream: ({ params }) => this.idg.pathwayDetail(params.stId),
  });

  toggle(stId: string) {
    this.expanded.update((open) => (open === stId ? null : stId));
  }

  /** Every pathway's top-level pathway, for colouring the pathway plot. */
  readonly hierarchy = rxResource({ stream: () => this.idg.hierarchy() });

  /** Interactions per data source: the portal's "Feature Summary". */
  readonly features = rxResource({
    params: () => {
      const term = this.term().trim();
      const available = this.datasets.hasValue() ? this.datasets.value() : undefined;
      return term && available?.length ? { term, available } : undefined;
    },
    stream: ({ params }) => this.idg.featureSummary(params.term, params.available),
  });

  /** Default to the specific and the significant, which is the readable answer. */
  readonly leavesOnly = signal(true);
  readonly significantOnly = signal(true);

  readonly pageSizes = PAGE_SIZES;
  readonly perPage = signal(PAGE_SIZES[0]);
  readonly page = signal(0);

  private readonly matching = computed<IdgRow[]>(() => {
    const found = (this.results.hasValue() ? this.results.value() : []) ?? [];
    const levels = (this.druggability.hasValue() ? this.druggability.value() : {}) ?? {};
    return found
      .filter(
        (pathway) =>
          (!this.leavesOnly() || pathway.bottomLevel) &&
          (!this.significantOnly() || pathway.fdr <= 0.05)
      )
      .map((pathway) => ({ ...pathway, tdl: levels[pathway.stId] }));
  });

  readonly pathways = computed(() => {
    const rows = this.matching();
    const size = this.perPage();
    const from = Math.min(this.page() * size, Math.max(0, rows.length - 1));
    return rows.slice(from, from + size);
  });

  /** "1-10 of 54", the way the portal says it. */
  readonly range = computed(() => {
    const total = this.matching().length;
    const size = this.perPage();
    const from = Math.min(this.page() * size, Math.max(0, total - 1));
    return { from: total ? from + 1 : 0, to: Math.min(from + size, total), total };
  });

  readonly lastPage = computed(() =>
    Math.max(0, Math.ceil(this.matching().length / this.perPage()) - 1)
  );

  readonly counts = computed(() => ({
    shown: this.pathways().length,
    matching: this.matching().length,
    total: ((this.results.hasValue() ? this.results.value() : []) ?? []).length,
  }));

  /**
   * The portal's "Interacting Pathway Plot": significance per pathway, coloured
   * by which part of biology the pathway sits in.
   *
   * Pathways run along x in hierarchy order, so a gene whose hits cluster in one
   * area shows as a band of one colour -- which is the point of the plot, and
   * something the table cannot show at any length.
   */
  readonly pathwayPlot = computed(() => {
    const rows = this.matching();
    if (!rows.length) return undefined;
    const tops = (this.hierarchy.hasValue() ? this.hierarchy.value() : {}) ?? {};

    const significance = (value: number) => (value > 0 ? -Math.log10(value) : 20);
    const tallest = Math.max(...rows.map((row) => significance(row.pVal)), 1);

    // Hierarchy order, so same-coloured points sit together.
    const ordered = [...rows].sort((a, b) =>
      (tops[a.stId] ?? 'zz').localeCompare(tops[b.stId] ?? 'zz')
    );

    const groups = new Map<string, number>();
    const points = ordered.map((row, index) => {
      const top = tops[row.stId] ?? 'Other';
      groups.set(top, (groups.get(top) ?? 0) + 1);
      return {
        stId: row.stId,
        name: row.name,
        top,
        colour: hueFor(top),
        pVal: row.pVal,
        x: ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100,
        y: (1 - significance(row.pVal) / tallest) * 100,
      };
    });

    return {
      points,
      tallest,
      legend: [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([top, count]) => ({ top, count, colour: hueFor(top) })),
    };
  });

  /**
   * The portal's "Genes vs Functional Interaction Score": how many predicted
   * interactors survive each threshold.
   *
   * A cumulative count rather than a histogram, which is what makes it useful for
   * choosing the threshold: the curve says what a move costs you.
   */
  readonly genesByScore = computed(() => {
    const sorted = this.sortedScores();
    if (!sorted.length) return undefined;
    const steps = 25;
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const score = index / steps;
      // sorted ascending, so everything from the first index at or above `score`.
      let low = 0;
      let high = sorted.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (sorted[middle] < score) low = middle + 1;
        else high = middle;
      }
      return { score, genes: sorted.length - low };
    });
    const most = Math.max(...points.map((point) => point.genes), 1);
    const placed = points.map((point) => ({
      ...point,
      x: point.score * 100,
      y: (1 - point.genes / most) * 100,
    }));
    return {
      most,
      points: placed,
      // The line through them, built here rather than in the template: a
      // polyline wants one string and the template should not be assembling it.
      polyline: placed.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
    };
  });

  /**
   * The portal's "Feature Summary": how many interactions each data source
   * reports, coloured by what kind of evidence it is.
   */
  readonly featurePlot = computed(() => {
    const found = (this.features.hasValue() ? this.features.value() : []) ?? [];
    if (!found.length) return undefined;
    const most = Math.max(...found.map((feature) => feature.count), 1);
    const kinds = new Map<string, number>();
    for (const feature of found) {
      kinds.set(feature.dataType, (kinds.get(feature.dataType) ?? 0) + 1);
    }
    const ordered = [...found].sort(
      (a, b) => a.dataType.localeCompare(b.dataType) || b.count - a.count
    );
    return {
      most,
      points: ordered.map((feature, index) => ({
        ...feature,
        colour: hueFor(feature.dataType),
        x: ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100,
        y: (1 - feature.count / most) * 100,
      })),
      legend: [...kinds.entries()].map(([dataType, count]) => ({
        dataType,
        count,
        colour: hueFor(dataType),
      })),
    };
  });

  /**
   * Significance against how well studied: the portal's actual question.
   *
   * A pathway high on this plot is enriched for the searched protein's
   * interactors; one on the left is full of proteins nobody has drugged. Top
   * left is therefore where there is something to find, which no ranking by
   * p-value alone will show you.
   */
  readonly scatter = computed(() => {
    // flatMap rather than filter: it narrows tdl to present, so the rest of this
    // reads without a non-null assertion on every line.
    const rows = this.matching().flatMap((row) =>
      row.tdl ? [{ stId: row.stId, name: row.name, fdr: row.fdr, tdl: row.tdl }] : []
    );
    if (!rows.length) return undefined;

    const levels = rows.map((row) => row.tdl.weightedTDL);
    const range = { min: Math.min(...levels), max: Math.max(...levels) };
    const span = range.max - range.min || 1;
    // -log10, so more significant is higher up, which is how these are read.
    const significance = (fdr: number) => (fdr > 0 ? -Math.log10(fdr) : 20);
    const tallest = Math.max(...rows.map((row) => significance(row.fdr)), 1.5);

    return {
      range,
      cutoff: (1 - Math.log10(1 / 0.05) / tallest) * 100,
      points: rows.map((row) => ({
        stId: row.stId,
        name: row.name,
        colour: row.tdl.colour ?? '#888',
        tdl: row.tdl.weightedTDL,
        fdr: row.fdr,
        x: ((row.tdl.weightedTDL - range.min) / span) * 100,
        y: (1 - significance(row.fdr) / tallest) * 100,
      })),
    };
  });

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
      const gene = normalise(this.route.snapshot.queryParamMap.get('gene') ?? '');
      if (gene !== untracked(this.term)) {
        this.entered.set(gene);
        this.term.set(gene);
      }
    });
  }

  /** Any change to what is listed puts you back on the first page. */
  private resetPage() {
    this.page.set(0);
  }

  search() {
    const gene = normalise(this.entered());
    // Put it back in the box too, so what was searched for is what is shown.
    this.entered.set(gene);
    this.term.set(gene);
    this.resetPage();
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
