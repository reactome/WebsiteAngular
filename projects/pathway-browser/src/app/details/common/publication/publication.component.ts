import { Component, computed, input } from '@angular/core';
import { LiteratureReference } from '../../../model/graph/publication/literature-reference.model';
import { Publication } from '../../../model/graph/publication/publication.model';
import {Person} from "../../../model/graph/person.model";
import { SafePipe } from '../../../pipes/safe.pipe';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'cr-publication',
  templateUrl: './publication.component.html',
  imports: [SafePipe, MatIcon],
  styleUrl: './publication.component.scss',
})
export class PublicationComponent {
  readonly ref = input.required<LiteratureReference | Publication>({ alias: 'publication' });
  readonly showYear = input<boolean>(false);
  isExpanded = false;

  /** Structured authors, when the ref has them. Falls back to authorName in the template. */
  readonly authors = computed<Person[]>(() => this.ref().author ?? []);
  /** Free-text author string, only used when no structured authors exist. */
  readonly authorName = computed<string>(() => this.authors().length ? '' : (this.ref().authorName ?? ''));


  toggleAuthors() {
    this.isExpanded = !this.isExpanded;
  }
}
