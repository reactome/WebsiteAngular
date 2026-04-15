import { Inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';
import { formatDate } from '@angular/common';

@Pipe({
  name: 'authorshipDateFormat',
  standalone: true,
})
export class AuthorshipDateFormatPipe implements PipeTransform {
  constructor(@Inject(LOCALE_ID) private locale: string) {}

  transform(dateTime: string) {
    if (!dateTime) return;
    try {
      return formatDate(dateTime, 'mediumDate', this.locale);
    } catch {
      return;
    }
  }
}
