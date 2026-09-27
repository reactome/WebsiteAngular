import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { AnalysisResult } from 'reactome-gsa-form';
import { AnalysisService } from '../../../services/analysis.service';
import { UrlStateService } from '../../../services/url-state.service';
import { GsaFormComponent, GsaFormModule } from 'reactome-gsa-form';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
  selector: 'cr-quantitative-analysis',
  imports: [GsaFormModule, MatButton, MatIcon, MatTooltip],
  templateUrl: './quantitative-analysis.component.html',
  styleUrl: './quantitative-analysis.component.scss',
})
export class QuantitativeAnalysisComponent {
  private state: UrlStateService = inject(UrlStateService);
  public analysis: AnalysisService = inject(AnalysisService);

  close = output<{ status: 'finished' | 'premature' }>();
  status = input.required<'open' | 'closed'>();

  gsaId = signal<string>('');

  /** For its guided tour, which otherwise only a ?gsa-tour= parameter starts. */
  readonly form = viewChild(GsaFormComponent);

  gsaFinished(token: string | undefined) {
    if (!token) return;
    this.state.analysis.set(token);
    this.close.emit({ status: 'finished' });
  }

  seeResultAction = (result: AnalysisResult) => {
    const link = result.reactome_links.find((link: any) => link.token);
    if (!link) return;
    this.state.analysis.set(link.token);
    this.close.emit({ status: 'finished' });
  };
}
