// EntityAdapter is the public type; it extends the internal EntityStateAdapter,
// which used to be deep-imported from "@ngrx/entity/src/models". NgRx 20 added
// an "exports" map that blocks those deep paths, and EntityAdapter provides the
// updateOne() this helper needs anyway.
import {EntityAdapter, EntityState, Update} from "@ngrx/entity";
import {EntityFetcher, EntityUpdater} from "../model/utils.model";
import { HttpErrorResponse } from "@angular/common/http";

export function isDefined<T>(o: T | undefined | null): o is T {
  return o !== undefined && o !== null
}

export function extractErrorMessage(err: HttpErrorResponse) {
  if (err.status === 502) return 'An unknown error occurred. The submitted dataset might be too large.';
  return err.error?.detail || (err.error as string).charAt(0) === '{' && JSON.parse(err.error)?.detail || err.message;
}

export class EntityHelper<T, S extends EntityState<T> = EntityState<T>> {

  constructor(public readonly adapter: EntityAdapter<T>) {
  }

  fetch: EntityFetcher<T, S> = (id, state) => state.entities[id]
  update: EntityUpdater<T, S> = (id, state, updater) => {
    const e = this.fetch(id, state)
    return !e ? state : this.adapter.updateOne({id, changes: updater(e)} as Update<T>, state)
  };
}

