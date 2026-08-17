import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LiteratureReference } from '../model/graph/publication/literature-reference.model';

@Pipe({
  name: 'includeRef',
  standalone: true,
})
export class IncludeRefPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string, refs: LiteratureReference[]): SafeHtml {
    refs
      .filter((ref) => ref && ref.url && ref.author?.length)
      .forEach((ref) => {
        const author = ref.author!;
        const replacer = (match: string) => `<a href="${ref.url}">${match}</a>`;
        text = text.replaceAll(
          new RegExp(
            `${author[0].surname} ?${this.initials(author[0].initial)}\\.? ?( et al[., ]{0,2})? ?${ref.year}`,
            'g'
          ),
          replacer
        );
        if (author.length === 2) {
          const regExp = new RegExp(
            `${author[0].surname} ?${this.initials(author[0].initial)}\\.? ?(and|&) ${author[1].surname} ?${this.initials(author[1].initial)}\\.? ?,? ${ref.year}`,
            'g'
          );
          text = text.replaceAll(regExp, replacer);
        }
      });
    return this.sanitizer.bypassSecurityTrustHtml(text);
  }

  initials(initials: string): string {
    return initials.split('').join('?') + '?';
  }
}
