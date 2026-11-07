import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Publication } from '../model/graph/publication/publication.model';

@Pipe({
  name: 'includeRef',
  standalone: true,
})
export class IncludeRefPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string, refs: Publication[]): SafeHtml {
    refs.forEach((ref) => {
      // Only an article has a link and a year to cite it by: a book has no
      // link, a web page holds its own as uniformResourceLocator.
      if (ref.schemaClass !== 'LiteratureReference' || !ref.url) return;
      // Refs whose authors are only curated as free-text authorName values have
      // no Person instances to build the citation pattern from.
      const author = ref.author ?? [];
      const [first, second] = author;
      if (!first) return;
      const replacer = (match: string) => `<a href="${ref.url}">${match}</a>`;
      text = text.replaceAll(
        new RegExp(
          `${first.surname} ?${this.initials(first.initial)}\\.? ?( et al[., ]{0,2})? ?${ref.year}`,
          'g'
        ),
        replacer
      );
      if (second && author.length === 2) {
        const regExp = new RegExp(
          `${first.surname} ?${this.initials(first.initial)}\\.? ?(and|&) ${second.surname} ?${this.initials(second.initial)}\\.? ?,? ${ref.year}`,
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
