import { HttpParams } from '@angular/common/http';

type Scalar = string | number | boolean;
type ParamValue = Scalar | readonly Scalar[] | null | undefined;

/**
 * Query parameters for HttpClient, leaving out any that are unset.
 *
 * Undefined, null and an empty list are not sent at all, rather than as
 * "undefined" or an empty value the services would read as a filter. A list
 * is sent as one parameter per value, as HttpClient sends a plain object's.
 *
 * Always returns parameters, possibly none, so a call never hands HttpClient
 * `params: undefined`. And it builds new ones: the object it is given is left
 * as it was, where the cleanObject() this replaces deleted the caller's keys.
 */
export function httpParams<T extends { [K in keyof T]: ParamValue }>(values?: T): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values ?? {}) as [string, ParamValue][]) {
    if (value === undefined || value === null) continue;
    if (isList(value)) {
      if (value.length) params = params.appendAll({ [key]: value });
    } else {
      params = params.set(key, value);
    }
  }
  return params;
}

function isList(value: Scalar | readonly Scalar[]): value is readonly Scalar[] {
  return Array.isArray(value);
}
