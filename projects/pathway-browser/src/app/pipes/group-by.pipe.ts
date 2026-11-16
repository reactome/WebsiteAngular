import { Injectable, Pipe, PipeTransform } from '@angular/core';
import { fieldByName } from '../services/utils';

/**
 * The value at a dotted path, read as `a?.[b]?.[c]` reads it: through any
 * value but null and undefined, a text's or number's own properties included.
 */
function valueAtPath(from: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, part) =>
        value === null || value === undefined ? undefined : fieldByName(new Object(value), part),
      from
    );
}

@Injectable({ providedIn: 'root' })
@Pipe({
  name: 'groupBy',
})
export class GroupByPipe implements PipeTransform {
  transform<T>(value: T[], property: string): { key: unknown; value: T[] }[] {
    if (!Array.isArray(value) || !property) return [];

    const grouped = new Map<unknown, T[]>();

    for (const item of value) {
      const key = valueAtPath(item, property);
      const group = grouped.get(key) ?? [];
      group.push(item);
      grouped.set(key, group);
    }

    // Return an array of objects, each object containing a group of objects
    return Array.from(grouped.entries()).map(([key, group]) => ({
      key,
      value: group,
    }));
  }
}
