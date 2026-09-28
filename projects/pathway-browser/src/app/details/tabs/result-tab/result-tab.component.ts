import {
  Component,
  computed,
  effect,
  ElementRef,
  linkedSignal,
  signal,
  Signal,
  untracked,
  viewChild,
  inject,
} from '@angular/core';
import { AnalysisService } from '../../../services/analysis.service';
import { AnalysisSummaryComponent } from '../../../analysis-summary/analysis-summary.component';
import { RevealDirective } from '../../../utils/reveal.directive';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import type { Analysis } from '../../../model/analysis.model';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule, Sort } from '@angular/material/sort';
import { DecimalPipe } from '@angular/common';
import { ScientificNumberPipe } from '../../../pipes/scientific-number.pipe';
import { UrlStateService } from '../../../services/url-state.service';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { DataStateService } from '../../../services/data-state.service';
import { TypeSafeMatCellDef } from '../../../utils/type-safe-mat-cell-def.directive';
import { TypeSafeMatRowDef } from '../../../utils/type-safe-mat-row-def.directive';
import { NotFoundTableComponent } from './not-found-table/not-found-table.component';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckbox, MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { ExpressionTagComponent } from './expression-tag/expression-tag.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { FoundTableComponent } from './found-table/found-table.component';
import { MatSliderModule } from '@angular/material/slider';
import { getArrayStats } from '../../../services/utils';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDivider } from '@angular/material/divider';
import { MatFormField, MatOption, MatSelect } from '@angular/material/select';

@Component({
  selector: 'cr-result-tab',
  imports: [
    AnalysisSummaryComponent,
    MatTableModule,
    RevealDirective,
    MatSortModule,
    MatPaginatorModule,
    DecimalPipe,
    ScientificNumberPipe,
    MatIconModule,
    MatTooltip,
    TypeSafeMatCellDef,
    TypeSafeMatRowDef,
    NotFoundTableComponent,
    FormsModule,
    MatButtonModule,
    MatMenuModule,
    MatCheckbox,
    MatRadioGroup,
    MatRadioButton,
    ExpressionTagComponent,
    MatExpansionModule,
    FoundTableComponent,
    MatSliderModule,
    MatButtonToggleModule,
    MatDivider,
    MatSelect,
    MatOption,
    MatFormField,
  ],
  templateUrl: './result-tab.component.html',
  styleUrl: './result-tab.component.scss',
})
export class ResultTabComponent {
  analysis = inject(AnalysisService);
  state = inject(UrlStateService);
  data = inject(DataStateService);

  readonly analysisType = computed(
    () =>
      this.analysis.summary()?.gsaMethod?.toUpperCase() ||
      titleCase(this.analysis.summary()?.type || '').replace('_', ' ')
  );

  trackBy = (index: number, pathway: Analysis.Pathway) => pathway.stId + '-' + index;

  readonly hasExpression = computed(() => this.analysis.result()?.expression?.min !== undefined);

  /**
   * Expression of the entity currently selected in the diagram, across every
   * sample.
   *
   * The pathway table answers "which pathways came up"; this answers "and what
   * did the thing I just clicked do", which otherwise meant stepping through
   * the samples one at a time and reading the value off the diagram.
   *
   * undefined when nothing is selected, when the selection is a complex or a
   * set (whose own identifier means nothing to an analysis), or when the
   * molecule was not in the submitted data.
   */
  readonly selectedExpression = computed<{ name: string; values: number[] } | undefined>(() => {
    const element = this.data.selectedElement();
    if (!element || this.analysis.samples().length === 0) return undefined;
    const reference = (element as Record<string, unknown>)['referenceEntity'] as
      { identifier?: string; variantIdentifier?: string } | undefined;
    const values = this.analysis.expressionFor([
      (element as Record<string, unknown>)['identifier'] as string | undefined,
      reference?.identifier,
      reference?.variantIdentifier,
    ]);
    return values ? { name: element.displayName, values } : undefined;
  });
  readonly minExpression = computed(() =>
    this.hasExpression() ? Math.floor(this.analysis.result()!.expression.min) : 0
  );
  readonly maxExpression = computed(() =>
    this.hasExpression() ? Math.ceil(this.analysis.result()!.expression.max) : 1
  );

  readonly pValuesColumnIds = computed(() =>
    this.analysis.hasPValues() ? ['entities-pValue', 'entities-fdr'] : []
  );

  readonly expressionColumnNames = computed(
    () => this.analysis.result()?.expression?.columnNames || []
  );

  readonly expressionColumnIds = computed(() =>
    this.expressionColumnNames().map((_, i) => `entities-exp-${i}`)
  );

  readonly displayedColumns: Signal<string[]> = computed(() => [
    'name',
    'expand-entities',
    'entities-found',
    'entities-total',
    ...this.pValuesColumnIds(),
    // 'entities-ratio',
    ...this.expressionColumnIds(),
    'reactions-found',
    'reactions-total',
    // 'reactions-ratio',
    'species-name',
  ]);

  dataSource = new MatTableDataSource<Analysis.Pathway>();

  readonly paginator = viewChild.required(MatPaginator);
  readonly sort = viewChild.required(MatSort);
  readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly headerRowHeight = signal('56px');
  readonly expandedRowHeight = signal('56px');

  sizeObserver = new ResizeObserver(() => {
    setTimeout(() => {
      this.headerRowHeight.set(
        (document.querySelector('tr.pathway-header-row')?.clientHeight || 56) + 'px'
      );
      this.expandedRowHeight.set(
        (document.querySelector('tr.pathway-row.expanded')?.clientHeight || 56) + 'px'
      );
    });
  });

  readonly currentSort = linkedSignal<Sort>(() =>
    this.analysis.hasPValues()
      ? {
          active: 'entities-fdr',
          direction: 'asc',
        }
      : {
          active: `entities-exp-${this.analysis.sampleIndex()}`,
          direction: 'desc',
        }
  );

  fdrValues = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1];
  readonly filterFDR = linkedSignal(() =>
    this.state.fdrFilter() !== undefined ? this.state.fdrFilter()! : 1
  );
  readonly fdrIndex = linkedSignal(() => this.fdrValues.indexOf(this.filterFDR()));
  fdrLabel = (index: number) => '' + this.fdrValues[index];

  readonly fdrFilterActive = computed(() => this.fdrIndex() < this.fdrValues.length - 1);

  readonly filterMinSize = linkedSignal(() =>
    this.state.pathwayMinSizeFilter() !== undefined
      ? this.state.pathwayMinSizeFilter()!
      : this.pathwaySizeStats().min
  );
  readonly filterMaxSize = linkedSignal(() =>
    this.state.pathwayMaxSizeFilter() !== undefined
      ? this.state.pathwayMaxSizeFilter()!
      : this.pathwaySizeStats().max
  );
  readonly sizeFilterActive = computed(
    () =>
      this.filterMinSize() !== this.pathwaySizeStats().min ||
      this.filterMaxSize() !== this.pathwaySizeStats().max
  );

  readonly filterMinExpression = linkedSignal(() =>
    this.state.minExpressionFilter() !== undefined
      ? this.state.minExpressionFilter()!
      : this.minExpression()
  );
  readonly filterMaxExpression = linkedSignal(() =>
    this.state.maxExpressionFilter() !== undefined
      ? this.state.maxExpressionFilter()!
      : this.maxExpression()
  );
  readonly expressionFilterActive = computed(
    () =>
      this.filterMinExpression() !== this.minExpression() ||
      this.filterMaxExpression() !== this.maxExpression()
  );

  readonly filterViewMode = linkedSignal(() => this.state.filterViewMode() || 'focus');
  readonly includeGrouping = linkedSignal(() => this.state.includeGrouping() !== false);
  readonly includeDisease = linkedSignal(() => this.state.includeDisease() !== false);

  readonly filteredDataNoSize = computed(() => {
    let data = this.analysis.result()?.pathways || [];
    if (this.includeGrouping() === false) {
      data = data.filter((p) => p.llp);
    }
    if (this.includeDisease() === false) {
      data = data.filter((p) => !p.inDisease);
    }
    if (this.state.fdrFilter() !== undefined) {
      data = data.filter((p) => p.entities.fdr <= this.state.fdrFilter()!);
    }
    if (this.state.minExpressionFilter() !== undefined) {
      data = data.filter(
        (p) => p.entities.exp[this.analysis.sampleIndex()] >= this.state.minExpressionFilter()!
      );
    }
    if (this.state.maxExpressionFilter() !== undefined) {
      data = data.filter(
        (p) => p.entities.exp[this.analysis.sampleIndex()] <= this.state.maxExpressionFilter()!
      );
    }
    if (this.state.gsaFilter().length !== 0) {
      data = data.filter((p) =>
        this.gsaFilterSet().has(p.entities.exp[this.analysis.sampleIndex()])
      );
    }
    return data;
  });

  readonly pathwaySizeStats = computed(() =>
    getArrayStats(this.filteredDataNoSize().map((p) => p.entities.total))
  );

  readonly filteredData = computed(() => {
    let data = this.filteredDataNoSize();
    if (this.state.pathwayMinSizeFilter()) {
      data = data.filter((p) => p.entities.total >= this.state.pathwayMinSizeFilter()!);
    }
    if (this.state.pathwayMaxSizeFilter()) {
      data = data.filter((p) => p.entities.total <= this.state.pathwayMaxSizeFilter()!);
    }
    return data;
  });

  readonly speciesOptions = computed(() => {
    const activatedFilters = new Set(untracked(this.state.speciesFilter));
    return this.analysis
      .speciesOptions()
      .map((s) => ({ ...s, value: activatedFilters.has(s.taxId) }));
  });

  readonly gsaFilterActive = computed(
    () => this.state.gsaFilter().length !== 0 && this.state.gsaFilter().length !== 5
  );

  readonly gsaFilterSet = computed(() => new Set(this.state.gsaFilter()));

  readonly gsaOptions = computed(() => {
    const activatedFilters = untracked(this.gsaFilterSet);
    return [2, 1, 0, -1, -2].map((exp) => ({
      exp,
      value: activatedFilters.has(exp),
      label: gsaValueToLabel.get(exp)!,
    }));
  });

  constructor() {
    this.dataSource.sortingDataAccessor = (data, header) =>
      header.split('-').reduce((a: any, b) => a?.[b], data);
    effect(() => {
      this.sizeObserver.observe(this.container().nativeElement);
    });
    effect(() => {
      this.dataSource.paginator = this.paginator();
      this.dataSource.sort = this.sort();
    });
    effect(() => (this.dataSource.data = this.filteredData()));
    effect(() => this.currentSort() && this.paginator().firstPage());
    effect(() => {
      if (this.currentSort()) setTimeout(() => (this.dataSource.sort = this.sort()));
    });
    effect(() => {
      const stId = this.data.selectedPathwayStId();
      if (!stId) return;
      setTimeout(() => {
        const index = this.dataSource
          .sortData(this.dataSource.filteredData, this.sort())
          .findIndex((p) => p.stId === stId);
        const pageSize = this.paginator().pageSize || this.paginator().pageSizeOptions[0] || 20;
        const pageIndex = Math.floor(index / pageSize);

        this.paginator().pageIndex = pageIndex;
        this.paginator().page.emit({
          length: this.paginator().length,
          pageSize,
          pageIndex,
        });
        // The row brings itself into view once it is on the page -- see
        // RevealDirective in the template. This effect only has to get the
        // paginator to the page the row is on.
      });
    });

    // Update URL from value change
    effect(() =>
      this.state.filterViewMode.set(
        this.filterViewMode() === 'focus' ? undefined : this.filterViewMode()
      )
    );
    effect(() => this.state.includeGrouping.set(this.includeGrouping() ? undefined : false));
    effect(() => this.state.includeDisease.set(this.includeDisease() ? undefined : false));
    effect(() =>
      this.state.pathwayMinSizeFilter.set(
        this.filterMinSize() !== this.pathwaySizeStats().min ? this.filterMinSize() : undefined
      )
    );
    effect(() =>
      this.state.pathwayMinSizeFilter.set(
        this.filterMinSize() !== this.pathwaySizeStats().min ? this.filterMinSize() : undefined
      )
    );
    effect(() =>
      this.state.pathwayMaxSizeFilter.set(
        this.filterMaxSize() !== this.pathwaySizeStats().max ? this.filterMaxSize() : undefined
      )
    );
    effect(() =>
      this.state.minExpressionFilter.set(
        this.filterMinExpression() !== this.minExpression() ? this.filterMinExpression() : undefined
      )
    );
    effect(() =>
      this.state.maxExpressionFilter.set(
        this.filterMaxExpression() !== this.maxExpression() ? this.filterMaxExpression() : undefined
      )
    );
    effect(() =>
      this.state.fdrFilter.set(this.fdrFilterActive() ? this.fdrValues[this.fdrIndex()] : undefined)
    );
  }

  selectPathway(pathway: Analysis.Pathway) {
    // if (this.state.select() !== pathway.stId) {
    this.data.selectedPathwayStId.set(pathway.stId);
    this.state.select.set(pathway.stId);
    if (this.expandedPathway() !== undefined && this.expandedPathway() !== pathway)
      this.expandedPathway.set(pathway);
    // } else {
    //   this.data.selectedPathwayStId.set(undefined)
    //   this.state.select.set(null)
    // }
  }

  visitPathway(pathway: Analysis.Pathway) {
    this.data.selectedPathwayStId.set(pathway.stId);
    //console.log("Navigating to " + pathway.stId)
    void this.state.navigateTo(pathway.stId, {
      queryParamsHandling: 'preserve',
      preserveFragment: true,
    });
  }

  onTogglableFilterClick(event: MouseEvent, checkbox: MatCheckbox) {
    event.stopPropagation(); // Avoid closing menu
    checkbox.toggle();
  }

  onToggleSpecies(event: MatCheckboxChange) {
    const value = event.source.value;
    this.state.speciesFilter.update((filters) =>
      event.checked ? [...filters, value] : filters.filter((f) => f !== value)
    );
  }

  onToggleGsaFilter(event: MatCheckboxChange) {
    const value = +event.source.value;
    this.state.gsaFilter.update((filters) =>
      event.checked ? [...filters, value] : filters.filter((f) => f !== value)
    );
  }

  isExpanded = (_index: number, pathway: Analysis.Pathway) => {
    return this.expandedPathway() === pathway;
  };

  readonly expandedPathway = signal<Analysis.Pathway | undefined>(undefined);

  toggle(pathway: Analysis.Pathway) {
    this.expandedPathway.set(this.isExpanded(0, pathway) ? undefined : pathway);
  }

  formatExpression = (expression: number) =>
    this.analysis.expressionScientificFormat()
      ? expression.toExponential(0)
      : expression.toFixed(0);

  colorExpression = (expression: number | undefined) =>
    this.analysis.palette().scale(expression).hex();

  readonly localMinExpression = linkedSignal(
    () => this.filterMinExpression() || this.minExpression()
  );
  readonly localMaxExpression = linkedSignal(
    () => this.filterMaxExpression() || this.maxExpression()
  );
  readonly expressionRange = computed(() => this.maxExpression() - this.minExpression());
  readonly gradientMask = computed(() => {
    const startPercentage =
      ((this.localMinExpression() - this.minExpression()) / this.expressionRange()) * 100;
    const endPercentage =
      ((this.localMaxExpression() - this.minExpression()) / this.expressionRange()) * 100;
    return `linear-gradient(to right,
                             black       ${startPercentage}%,
                             transparent ${startPercentage}%,
                             transparent ${endPercentage}%,
                             black       ${endPercentage}%)`;
  });
}

const gsaValueToLabel = new Map([
  [2, 'Sig. up regulated'],
  [1, 'Up regulated'],
  [0, 'Not regulated'],
  [-1, 'Down regulated'],
  [-2, 'Sig. down regulated'],
]);

const titleCase = (s: string) =>
  s
    .split(' ')
    .map((ss) => ss.charAt(0).toUpperCase() + ss.slice(1).toLowerCase())
    .join(' ');
