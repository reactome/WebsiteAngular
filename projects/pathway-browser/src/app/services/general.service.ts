import {computed, Injectable, resource} from '@angular/core';
import {CONTENT_SERVICE, DOWNLOAD, VERSION_FALLBACK, environment} from "../../environments/environment";
import {HttpClient} from "@angular/common/http";
import {rxResource} from "@angular/core/rxjs-interop";
import {catchError, filter, map, Observable, of, take} from "rxjs";
import {toObservable} from "@angular/core/rxjs-interop";

@Injectable({
  providedIn: 'root'
})
export class GeneralService {

  constructor(private http: HttpClient) { }

  version = rxResource({
    params: () => true,
    // Resolve the current database version, falling back to a CORS-enabled
    // public endpoint when the primary content service version call fails.
    // The version is required to build CORS-enabled S3 diagram URLs.
    stream: () => this.http.get<number>(`${CONTENT_SERVICE}/data/database/version`).pipe(
      catchError(() => this.http.get<number>(VERSION_FALLBACK))
    )
  })

  download = computed(() => environment.preferS3 && this.version.value() ? `${environment.s3}/${this.version.value()}` : DOWNLOAD)

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
