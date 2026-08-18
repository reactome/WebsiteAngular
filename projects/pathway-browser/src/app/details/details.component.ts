import { Component, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { UntilDestroy } from '@ngneat/until-destroy';
import { AnalysisService } from '../services/analysis.service';
import { DataStateService } from '../services/data-state.service';
import { UrlStateService } from '../services/url-state.service';
import { MatTabGroup, MatTab, MatTabLabel, MatTabContent } from '@angular/material/tabs';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { DescriptionTabComponent } from './tabs/description-tab/description-tab.component';
import { MoleculeTabComponent } from './tabs/molecule-tab/molecule-tab.component';
import { ResultTabComponent } from './tabs/result-tab/result-tab.component';
import { ExpressionTabComponent } from './tabs/expression-tab/expression-tab.component';
import { InfoTabComponent } from './tabs/info-tab/info-tab.component';
import { DownloadTabComponent } from './tabs/download-tab/download-tab.component';
import { IS_CURATOR } from '../../environments/environment';

@Component({
  selector: 'cr-details-panel',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss'],
  standalone: true,
  imports: [
    MatTabGroup,
    MatTab,
    MatTabLabel,
    MatTabContent,
    MatIcon,
    MatProgressSpinner,
    DescriptionTabComponent,
    MoleculeTabComponent,
    ResultTabComponent,
    ExpressionTabComponent,
    InfoTabComponent,
    DownloadTabComponent,
  ],
})
@UntilDestroy()
export class DetailsComponent {
  // The curator build is a tool, not the public site: several panels are
  // hidden there. Gated rather than commented out, which is how they went
  // missing from the public site in the first place.
  readonly isCurator = IS_CURATOR;

  protected analysis: AnalysisService = inject(AnalysisService);
  public dataState: DataStateService = inject(DataStateService);
  public state: UrlStateService = inject(UrlStateService);

  obj = this.dataState.selectedElement;
  hasResult = computed(() => !!this.analysis.result());
  hasDetail = computed(() => this.dataState.hasDetail());

  /**
   * The tab names, in the order the template renders them.
   *
   * This has to be derived rather than a fixed list: Results, Expression and
   * Download are only rendered outside the curator build, so a static array puts
   * the wrong name against an index as soon as one is absent. It was already
   * wrong that way once -- clicking Results wrote ?tab=expression -- and adding
   * the Expression tab back broke it again, so the ordering here has to mirror
   * the template exactly.
   */
  readonly tabs = computed<string[]>(() => [
    'details',
    'molecule',
    ...(this.isCurator ? [] : ['results', 'expression']),
    'info',
    ...(this.isCurator ? [] : ['download']),
  ]);

  selectedTabIndex = linkedSignal<number>(() =>
    Math.max(0, this.tabs().indexOf(this.state.tab() || 'info'))
  );

  constructor() {
    // Did the link that opened this panel name a tab? Captured once, before any
    // effect runs, because the effect below writes the tab into the URL as soon
    // as one is selected -- so reading it later cannot tell an explicit choice
    // from something we just set ourselves.
    const tabCameFromUrl = !!untracked(this.state.tab);

    effect(() => this.state.tab.set(this.tabs()[this.selectedTabIndex()!]));

    effect(() => {
      // A shared link that says ?tab=download has to land on Download. These
      // branches are defaults for links that name no tab, and they used to run
      // unconditionally -- only the first checked -- so every deep link was
      // rewritten to details or results on arrival.
      //
      // Links without a tab keep the old behaviour, including moving to Results
      // when an analysis finishes, which is the point of running one.
      if (tabCameFromUrl) return;

      if (this.state.section()) this.state.tab.set('details');
      else if (this.hasResult()) this.state.tab.set('results');
      else if (this.hasDetail()) this.state.tab.set('details');
      else this.state.tab.set('info');
    });
  }
}
