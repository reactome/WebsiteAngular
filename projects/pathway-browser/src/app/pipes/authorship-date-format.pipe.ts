import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';
import { formatDate } from '@angular/common';

@Pipe({
  name: 'authorshipDateFormat',
  standalone: true,
})
export class AuthorshipDateFormatPipe implements PipeTransform {
  private locale = inject(LOCALE_ID);


  transform(dateTime: string) {
    if (!dateTime) return;
    try {
      return formatDate(dateTime, 'mediumDate', this.locale);
    } catch {
      return;
    }
  }
}
