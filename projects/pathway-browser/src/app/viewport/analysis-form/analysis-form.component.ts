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
  private http: HttpClient = inject(HttpClient);
  private state: UrlStateService = inject(UrlStateService);
  public analysis: AnalysisService = inject(AnalysisService);

  qualitative = this.http.get('assets/icons/analysis/Qualitative.svg', { responseType: 'text' });
  quantitative = this.http.get('assets/icons/analysis/Quantitative.svg', { responseType: 'text' });
  species = this.http.get('assets/icons/analysis/SpeciesCompare.svg', { responseType: 'text' });
  tissue = this.http.get('assets/icons/analysis/TissueCompare.svg', { responseType: 'text' });

  close = output<{ status: 'finished' | 'premature' }>();
  status = input.required<'open' | 'closed'>();

  private static readonly TAB_INDEX = {
    qualitative: 0,
    quantitative: 1,
    species: 2,
    tissue: 3,
  } as const;
  selectedTabIndex = computed(
    () => AnalysisFormComponent.TAB_INDEX[this.state.analysisTab() ?? 'qualitative']
  );
}
