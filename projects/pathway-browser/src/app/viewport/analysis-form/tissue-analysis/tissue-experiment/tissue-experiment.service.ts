import { Injectable, ResourceRef, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { TissueExperiment } from './tissue-experiment.model';
import { Observable } from 'rxjs';
import {
  DIGESTER_FOR_BACKEND,
  environment,
  IS_CURATOR,
} from '../../../../../environments/environment';
import { rxResource } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root',
})
export class TissueExperimentService {
  private http = inject(HttpClient);

  // The curator host has no /ExperimentDigester, so the curator variant asks for
  // nothing and the resource stays idle. Every other deployment does have one --
  // beta and dev answer /ExperimentDigester/experiments/summaries with the tissue
  // list -- and disabling it for all of them emptied the Available Tissues column
  // on the public site, where tissue analysis is a real feature.
  //
  // A constraint that belongs to one deployment is expressed as one deployment's
  // constraint. Gate on the variant, not on everyone.
  summaries = rxResource({
    params: () => (IS_CURATOR ? undefined : {}),
    stream: () => this.getExperimentsSummary(),
  });

  getExperimentsSummary(): Observable<TissueExperiment.Summaries> {
    return this.http.get<TissueExperiment.Summaries>(`/ExperimentDigester/experiments/summaries`);
  }

  /**
   * Where the analysis service should fetch this sample from.
   *
   * Not a URL for the browser: it is posted to the analysis service, which
   * downloads it itself. So it has to resolve from inside the backend, and the
   * hardcoded https://127.0.0.1/... it used to return does not -- the analysis
   * service answered 422 for every tissue analysis, because nothing terminates
   * TLS for that name.
   */
  getSampleURL(
    id: number,
    { omitNulls, columns }: { omitNulls: boolean; columns: number[] }
  ): string {
    const included = columns.map((column) => `included=${column}`).join('&');
    return `${DIGESTER_FOR_BACKEND}/experiments/${id}/sample?omitNulls=${omitNulls}&${included}`;
  }

  /**
   * Should not be used as we let the backend handle the download and analysis using the URL
   * @param id
   * @param omitNulls
   * @param columns
   */
  getSample(
    id: number,
    { omitNulls, columns }: { omitNulls: boolean; columns: number[] }
  ): Observable<string> {
    const params: TissueExperiment.SampleParams = {
      omitNulls,
      included: columns,
    };
    return this.http.get(`${environment.host}/experiments/${id}/sample`, {
      responseType: 'text',
      params,
    });
  }
}
