import { computed, Injectable, inject } from '@angular/core';
import { Method } from '../model/methods.model';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { extractErrorMessage } from '../utilities/utils';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfigProvider, REACTOME_GSA_CONFIG } from '../config/gsa-config';

/** Reads a parameter's text as its type: a boolean, a number, or the text itself. */
type Parser = (value: string) => any;

const typeToParse: { [p: string]: Parser } = {
  bool: (value) => value.toLowerCase() === 'true',
  float: parseFloat,
  int: parseInt,
  email: (value) => value,
  string: (value) => value,
};

/**
 * How to read a parameter of this type. A type this form does not know -- one
 * the service added since -- is read as text, rather than taking the whole form
 * down with it.
 */
export const parserFor = (type: string): Parser => typeToParse[type] ?? ((text: string) => text);

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
