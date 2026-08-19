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

  // Authors come from the linked Person instances when they exist, and fall back
  // to the curated free-text authorName values otherwise. Both attributes are
  // multivalued, so every value is listed. ORCID ids only exist on Person, so
  // they are undefined for the authorName case.
  readonly authors = computed<{ name: string, orcidId?: string }[]>(() =>
    this.usesAuthorName()
      ? this.authorNames().map(name => ({name}))
      : this.people().map(person => ({name: person.displayName, orcidId: person.orcidId})));

  // displayName is the composed citation ("Kerr JF et al, 1972") in the public
  // content service. The curation graph leaves it unset or unhelpful, so use the
  // title attribute whenever the authorName fallback is in play.
  readonly title = computed(() => this.usesAuthorName() ? this.ref().title : this.ref().displayName);

  private asArray<E>(value: E[] | E | undefined | null): E[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }


  toggleAuthors() {
    this.isExpanded = !this.isExpanded;
  }
}