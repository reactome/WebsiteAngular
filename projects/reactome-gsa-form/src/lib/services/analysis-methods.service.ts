import { computed, Injectable, inject } from '@angular/core';
import type { Method } from '../state/method/method.state';
import type { ParameterValue } from '../model/parameter.model';
import { ParameterType } from '../model/methods.model';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { extractErrorMessage } from '../utilities/utils';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfigProvider, REACTOME_GSA_CONFIG } from '../config/gsa-config';

/** Reads a parameter's text as its type: a boolean, a number, or the text itself. */
type Parser = (value: string) => ParameterValue;

const typeToParse: Record<ParameterType, Parser> = {
  [ParameterType.bool]: (value) => value.toLowerCase() === 'true',
  [ParameterType.float]: parseFloat,
  [ParameterType.int]: parseInt,
  [ParameterType.email]: (value) => value,
  [ParameterType.string]: (value) => value,
};

const isKnownType = (type: string): type is ParameterType => Object.hasOwn(typeToParse, type);

/**
 * How to read a parameter of this type. A type this form does not know -- one
 * the service added since -- is read as text, rather than taking the whole form
 * down with it.
 */
export const parserFor = (type: string): Parser =>
  isKnownType(type) ? typeToParse[type] : (text: string) => text;

/**
 * A parameter's default as the service sent it, read as its type. The service
 * sends text, and the data sources' parameters none at all: an absent one stays
 * absent, but for a number's, which parsing read as NaN.
 */
export function readDefault(
  type: string,
  sent: ParameterValue | undefined
): ParameterValue | undefined {
  if (typeof sent === 'string') return parserFor(type)(sent);
  if (sent === undefined && (type === ParameterType.int || type === ParameterType.float))
    return NaN;
  return sent;
}

@Injectable({
  providedIn: 'root',
})
export class AnalysisMethodsService {
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private config = inject<ConfigProvider>(REACTOME_GSA_CONFIG);

  readonly methodsUrl = computed(() => `${this.config().apiRoot}/methods`);

  getAll(): Observable<Method[]> {
    return this.http.get<Method[]>(this.methodsUrl()).pipe(
      catchError((err: HttpErrorResponse) => {
        this.snackBar.open(
          "The methods couldn't be loaded: \n" + extractErrorMessage(err),
          'Close',
          {
            panelClass: ['warning-snackbar'],
          }
        );
        return throwError(() => err); //Rethrow it back to component
      })
    );
  }
}
