import { Pipe, PipeTransform } from '@angular/core';

/** A key any member of a union has: `year` on a publication, which a web page lacks. */
type KeyOfAny<T> = T extends unknown ? keyof T : never;

@Pipe({
  name: 'sortByDate',
  standalone: true,
})
export class SortByDatePipe implements PipeTransform {
  transform<T extends object, K extends KeyOfAny<T>>(
    value: T[],
    property: K,
    descending: boolean = true
  ) {
    if (!property) return value;

    // An item without the key reads as undefined, as indexing it always did.
    const read = (item: T): unknown => (property in item ? item[property] : undefined);
    return value.sort((a, b) => {
      const propA = read(a);
      const propB = read(b);

      if (propA == null && propB == null) return 0; // Both null/undefined, treat as equal
      if (propA == null) return 1; // Move null/undefined to the end
      if (propB == null) return -1;

      const comparison = propA > propB ? 1 : propA < propB ? -1 : 0;
      return descending ? -comparison : comparison;
    });
  }
}
