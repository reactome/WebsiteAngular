import { CdkRowDef } from '@angular/cdk/table';
import { Directive, input } from '@angular/core';
import { MatRowDef, MatTableDataSource } from '@angular/material/table';
import { Observable } from 'rxjs';

// https://nartc.me/blog/typed-mat-cell-def

@Directive({
  selector: '[matRowDef]', // same selector as MatRowDef
  providers: [{ provide: CdkRowDef, useExisting: TypeSafeMatRowDef }],
})
export class TypeSafeMatRowDef<T> extends MatRowDef<T> {
  // leveraging syntactic-sugar syntax when we use *matRowDef
  // @Input() cdkRowDefDataSource?: T[] | Observable<T[]> | DataSource<T>;
  readonly matRowDefDataSource = input.required<T[] | Observable<T[]> | MatTableDataSource<T>>();

  // ngTemplateContextGuard flag to help with the Language Service
  static ngTemplateContextGuard<T>(
    _dir: TypeSafeMatRowDef<T>,
    _ctx: unknown
  ): _ctx is { $implicit: T; index: number } {
    return true;
  }
}
