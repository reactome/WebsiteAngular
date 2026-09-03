import {Component, computed, input} from '@angular/core';
import {LiteratureReference} from "../../../model/graph/publication/literature-reference.model";
import {Publication} from "../../../model/graph/publication/publication.model";
import {SafePipe} from "../../../pipes/safe.pipe";
import {MatIcon} from "@angular/material/icon";


@Component({
  selector: 'cr-publication',
  templateUrl: './publication.component.html',
  imports: [
    SafePipe,
    MatIcon
],
  styleUrl: './publication.component.scss'
})
export class PublicationComponent{
  readonly ref = input.required<LiteratureReference | Publication>({ alias: "publication" });
  readonly showYear = input<boolean>(false);
  isExpanded = false;

  private readonly people = computed(() =>
    this.asArray(this.ref().author).filter(person => !!person));

  private readonly authorNames = computed(() =>
    this.asArray(this.ref().authorName)
      .map(name => name?.trim())
      .filter((name): name is string => !!name));

  // True for the curation graph shape: no linked Person instances, but free-text
  // authorName values to fall back on.
  private readonly usesAuthorName = computed(() =>
    this.people().length === 0 && this.authorNames().length > 0);

  /** Heading text: `title` for newer instances, `displayName` for older ones. */
  readonly heading = computed<string>(() => {
    const ref = this.ref();
    return (this.isNewerInstance() ? ref.title?.trim() : '') || ref.displayName;
  });

  /** Free-text author byline, only used when no structured authors exist. */
  readonly authorName = computed<string>(() =>
    this.authors().length ? '' : composeAuthorByline(this.ref().authorName)
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

  // displayName is the composed citation ("Kerr JF et al, 1972") in the public
  // content service. The curation graph leaves it unset or unhelpful, so use the
  // title attribute whenever the authorName fallback is in play.
  readonly title = computed(() => this.usesAuthorName() ? this.ref().title : this.ref().displayName);

  private asArray<E>(value: E[] | E | undefined | null): E[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }


  toggleAuthors() {
    this.expanded.update((expanded) => !expanded);
  }

  private toAuthorView(author: Person): AuthorView {
    return {
      name: [author.surname, author.initial].filter(Boolean).join(' '),
      dbId: author.dbId,
      orcidId: author.orcidId,
    };
    this.isExpanded = !this.isExpanded;
  }
}