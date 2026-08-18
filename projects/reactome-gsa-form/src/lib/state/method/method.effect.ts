import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Injectable, inject } from '@angular/core';
import { AnalysisMethodsService, typeToParse } from '../../services/analysis-methods.service';
import { methodActions } from './method.action';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { ParameterType } from '../../model/methods.model';
import { ConfigProvider, GsaConfig, REACTOME_GSA_CONFIG } from '../../config/gsa-config';

@Injectable({ providedIn: 'root' })
export class MethodEffects {
  private actions$ = inject(Actions);
  private methodService = inject(AnalysisMethodsService);
  private config = inject<ConfigProvider>(REACTOME_GSA_CONFIG);

  loadMethods$ = createEffect(() =>
    this.actions$.pipe(
      ofType(methodActions.load),
      exhaustMap(() =>
        this.methodService.getAll().pipe(
          map((methods) => {
            methods.forEach((method) => {
              method.parameters.forEach((param) => {
                param.type = param.name === 'email' ? ParameterType.email : param.type;
                param.value = typeToParse[param.type](param.default);
                param.default = typeToParse[param.type](param.default);
              });
              const server = method.parameters.find((param) => param.name === 'reactome_server');
              if (server) server.value = this.config().server;
            });
            return methodActions.loadSuccess({ methods });
          }),
          catchError((err) => of(methodActions.loadFailure({ error: err })))
        )
      )
    )
  );
}
