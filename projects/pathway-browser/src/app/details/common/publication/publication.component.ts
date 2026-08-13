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

  // Authors come from either the curated free-text authorName values or, when
  // those are absent, the linked Person instances. Both attributes are
  // multivalued, so every value is listed. ORCID ids only exist on Person, so
  // they are undefined for the authorName case.
  readonly authors = computed<{ name: string, orcidId?: string }[]>(() => {
    const ref = this.ref();
    const authorNames = this.asArray(ref.authorName)
      .map(name => name?.trim())
      .filter((name): name is string => !!name);

    if (authorNames.length > 0) {
      return authorNames.map(name => ({name}));
    }

    return this.asArray(ref.author)
      .filter(person => !!person)
      .map(person => ({name: person.displayName, orcidId: person.orcidId}));
  });

  private asArray<E>(value: E[] | E | undefined | null): E[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }


  toggleAuthors() {
    this.isExpanded = !this.isExpanded;
  }
}
