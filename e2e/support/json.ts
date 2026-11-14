import type { Request } from '@playwright/test';

/** A JSON object, read field by field. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** A request's JSON body, when it is an object; null otherwise. */
export function bodyOf(request: Request): Record<string, unknown> | null {
  const body: unknown = request.postDataJSON();
  return isRecord(body) ? body : null;
}
