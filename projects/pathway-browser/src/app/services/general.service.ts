import { computed, Injectable, resource, inject } from '@angular/core';
import {
  CONTENT_SERVICE,
  DOWNLOAD,
  IS_CURATOR,
  VERSION_FALLBACK,
  environment,
} from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, filter, map, Observable, of, take } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root',
})
export class GeneralService {
  private http = inject(HttpClient);

  version = rxResource({
    // A curation graph has no released version: the curator content service
    // errors on this endpoint and there is no public release to fall back to.
    // Returning undefined keeps the resource idle so no request is sent; the
    // version is only needed for S3 diagram paths, which curator builds do not
    // use (preferS3 is false there).
    params: () => (IS_CURATOR ? undefined : true),
    // Resolve the current database version, falling back to a CORS-enabled
    // public endpoint when the primary content service version call fails.
    // The version is required to build CORS-enabled S3 diagram URLs.
    stream: () =>
      this.http
        .get<number>(`${CONTENT_SERVICE}/data/database/version`)
        .pipe(catchError(() => this.http.get<number>(VERSION_FALLBACK))),
  });

  download = computed(() =>
    environment.preferS3 && this.version.value()
      ? `${environment.s3}/${this.version.value()}`
      : DOWNLOAD
  );

  // Emits the download base URL once it is settled. When S3 is preferred we
  // must wait for the version to resolve, otherwise the base URL falls back to
  // a non-CORS host and diagram requests get blocked by the browser.
  download$: Observable<string> = environment.preferS3
    ? toObservable(this.version.value).pipe(
        filter((version): version is number => !!version),
        map((version) => `${environment.s3}/${version}`),
        take(1)
      )
    : of(DOWNLOAD);
}
