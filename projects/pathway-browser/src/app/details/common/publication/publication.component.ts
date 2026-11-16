import { Component, computed, input, signal } from '@angular/core';
import { Publication } from '../../../model/graph/publication/publication.model';
import { Person } from '../../../model/graph/person.model';
import { SafePipe } from '../../../pipes/safe.pipe';
import { MatIcon } from '@angular/material/icon';
import { CONTENT_DETAIL } from '../../../../environments/environment';
import { authorNameEntries, composeAuthorByline } from './publication-byline';

/** One rendered author: the pre-composed label plus what the template needs to link it. */
export interface AuthorView {
  name: string;
  dbId?: number;
  orcidId?: string | undefined;
}

@Component({
  selector: 'cr-publication',
  templateUrl: './publication.component.html',
  imports: [SafePipe, MatIcon],
  styleUrl: './publication.component.scss',
})
export class PublicationComponent {
  // Absolute, host-aware detail URL, the same constant object-tree uses.
  // The old commented-out markup referenced a bare `environment`, which this
  // component never had -- the hrefs came out as "undefined/content/detail/...".
  readonly contentDetail = CONTENT_DETAIL;

  readonly publication = input.required<Publication>();
  readonly showYear = input<boolean>(false);

  private readonly expanded = signal(false);

  /** The ref when it is a journal article, the one kind with a journal and a link. */
  private readonly literature = computed(() => {
    const ref = this.publication();
    return ref.schemaClass === 'LiteratureReference' ? ref : undefined;
  });

  /** Structured authors, when the ref has them. */
  private readonly authors = computed<Person[]>(() => this.publication().author ?? []);

  /**
   * Newer instances populate authorName and carry the citation text in `title`; older ones
   * only have the pre-composed `displayName`. Read the raw attribute rather than authorName()
   * below, which is blanked out when structured authors take precedence for the byline.
   *
   * Goes through authorNameEntries because the attribute is a list on the curation graph and
   * a string on the public content service -- calling `.trim()` straight on it threw a
   * TypeError that blanked out every reference in the details panel against the curator
   * backend.
   */
  private readonly isNewerInstance = computed<boolean>(
    () => authorNameEntries(this.publication().authorName).length > 0
  );

  /** Heading text: `title` for newer instances, `displayName` for older ones. */
  readonly heading = computed<string>(() => {
    const ref = this.publication();
    return (this.isNewerInstance() ? ref.title.trim() : '') || ref.displayName;
  });

  /** Free-text author byline, only used when no structured authors exist. */
  readonly authorName = computed<string>(() =>
    this.authors().length ? '' : composeAuthorByline(this.publication().authorName)
  );

  /** Whether there is any byline to show at all, from either source. */
  readonly hasByline = computed<boolean>(() => this.authors().length > 0 || !!this.authorName());

  readonly firstAuthor = computed<AuthorView | undefined>(() => {
    const first = this.authors().at(0);
    return first && this.toAuthorView(first);
  });

  /** The authors after the first, empty while collapsed. */
  readonly additionalAuthors = computed<AuthorView[]>(() =>
    this.expanded()
      ? this.authors()
          .slice(1)
          .map((author) => this.toAuthorView(author))
      : []
  );

  readonly orcidUrl = computed<string>(() => {
    const orcidId = this.firstAuthor()?.orcidId;
    return orcidId ? `https://orcid.org/${orcidId}` : '';
  });

  /** Only the first author is named while collapsed, so the rest are stood in for by "et al." */
  readonly showEtAl = computed<boolean>(() => this.authors().length > 1 && !this.expanded());

  /** A single author has nothing to expand into. */
  readonly canToggle = computed<boolean>(() => this.authors().length > 1);

  readonly toggleIcon = computed<string>(() => (this.expanded() ? 'collapse' : 'expand'));

  /** Year to render, or undefined when hidden by the input or missing from the ref. */
  readonly year = computed<number | undefined>(() => {
    const ref = this.publication();
    // An article and a book have a year; a web page has none.
    return this.showYear() && 'year' in ref ? ref.year : undefined;
  });

  readonly journal = computed<string>(() => this.literature()?.journal ?? '');

  readonly citationUrl = computed<string>(() => this.literature()?.url ?? '');

  toggleAuthors() {
    this.expanded.update((expanded) => !expanded);
  }

  private toAuthorView(author: Person): AuthorView {
    return {
      name: [author.surname, author.initial].filter(Boolean).join(' '),
      dbId: author.dbId,
      orcidId: author.orcidId,
    };
  }
}
