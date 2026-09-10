import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { AsyncPipe } from '@angular/common';
import { QualitativeAnalysisComponent } from './qualitative-analysis/qualitative-analysis.component';
import { HttpClient } from '@angular/common/http';
import { SafePipe } from '../../pipes/safe.pipe';
import { GsaFormModule } from 'reactome-gsa-form';
import { AnalysisService } from '../../services/analysis.service';
import { UrlStateService } from '../../services/url-state.service';
import { QuantitativeAnalysisComponent } from './quantitative-analysis/quantitative-analysis.component';
import { TissueAnalysisComponent } from './tissue-analysis/tissue-analysis.component';
import { SpeciesAnalysisComponent } from './species-analysis/species-analysis.component';
import { IS_CURATOR } from '../../../environments/environment';

@Component({
  selector: 'cr-analysis-form',
  imports: [
    MatTab,
    MatTabGroup,
    MatTabLabel,
    QualitativeAnalysisComponent,
    QualitativeAnalysisComponent,
    SafePipe,
    AsyncPipe,
    GsaFormModule,
    QuantitativeAnalysisComponent,
    TissueAnalysisComponent,
    SpeciesAnalysisComponent,
  ],
  templateUrl: './analysis-form.component.html',
  styleUrl: './analysis-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisFormComponent {
  // No GSA server sits behind the curator host, so the Quantitative tab is left
  // out of that build. Gating the tab is what stops the traffic: every
  // /GSAServer request comes from inside the embedded gsa-form (the methods list
  // is fetched as soon as it initialises), so never rendering it is the only way
  // to keep those endpoints untouched.
  readonly isCurator = IS_CURATOR;

  private http: HttpClient = inject(HttpClient);
  private state: UrlStateService = inject(UrlStateService);
  public analysis: AnalysisService = inject(AnalysisService);

  qualitative = this.http.get('assets/icons/analysis/Qualitative.svg', { responseType: 'text' });
  quantitative = this.http.get('assets/icons/analysis/Quantitative.svg', { responseType: 'text' });
  species = this.http.get('assets/icons/analysis/SpeciesCompare.svg', { responseType: 'text' });
  tissue = this.http.get('assets/icons/analysis/TissueCompare.svg', { responseType: 'text' });

  close = output<{ status: 'finished' | 'premature' }>();
  status = input.required<'open' | 'closed'>();

  /**
   * The tab names, in the order the template renders them.
   *
   * Derived rather than a fixed index map: Quantitative is absent in the curator
   * build, which shifts every tab after it, so the ordering here has to mirror
   * the template exactly.
   */
  private readonly tabs: string[] = [
    'qualitative',
    ...(this.isCurator ? [] : ['quantitative']),
    'species',
    'tissue',
  ];

  selectedTabIndex = computed(() =>
    Math.max(0, this.tabs.indexOf(this.state.analysisTab() ?? 'qualitative'))
  );
}
