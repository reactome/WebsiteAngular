import {Component, computed, effect, inject, linkedSignal, untracked} from '@angular/core';
import {UntilDestroy} from "@ngneat/until-destroy";
import {AnalysisService} from "../services/analysis.service";
import {DataStateService} from "../services/data-state.service";
import {UrlStateService} from "../services/url-state.service";


@Component({
  selector: 'cr-details-panel',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss'],
  standalone: false
})
@UntilDestroy()
export class DetailsComponent {
  protected analysis: AnalysisService = inject(AnalysisService);
  public dataState: DataStateService = inject(DataStateService);
  public state: UrlStateService = inject(UrlStateService);

  obj = this.dataState.selectedElement;
  hasResult = computed(() => !!(this.analysis.result()));
  hasDetail = computed(() => (this.dataState.hasDetail()))

  tabs: string[] = [
    'details',
    'molecule',
    'results',
    'expression',
    'info',
    'download',
  ]

  selectedTabIndex = linkedSignal<number>(
    () => this.tabs.indexOf(this.state.tab() || 'info')
  )


  constructor() {
    effect(() => this.state.tab.set(this.tabs[this.selectedTabIndex()!]));
    effect(() => {
      if (!untracked(this.state.tab) && this.state.section()) this.state.tab.set('details'); // Make publication link still work as they didn't include the tab, but sections
      else if (this.hasResult()) this.state.tab.set('results');
      else if (this.hasDetail()) this.state.tab.set('details');
      else this.state.tab.set('info');
    });
  }

}
