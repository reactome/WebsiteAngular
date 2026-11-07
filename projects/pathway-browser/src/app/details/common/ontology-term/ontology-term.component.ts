import { Component, computed, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TitleCasePipe } from '@angular/common';
import { DatabaseObject } from '../../../model/graph/database-object.model';

/**
 * A GO term or a term of an external ontology, as this link shows it. A term
 * of a class never recorded (an anatomy term, a cell type) may lack its link
 * and its database, as the contract says.
 */
/** What the link reads of a term, each field optional as each kind of term has some. */
interface OntologyFields {
  name?: string[] | string;
  url?: string;
  databaseName?: string;
  definition?: string;
  identifier?: string;
  accession?: string;
}

export type OntologyTerm = DatabaseObject & OntologyFields;

@Component({
  selector: 'cr-ontology-term',
  imports: [MatTooltip, TitleCasePipe],
  templateUrl: './ontology-term.component.html',
  styleUrl: './ontology-term.component.scss',
})
export class OntologyTermComponent {
  readonly term = input.required<OntologyTerm>();
  readonly titleCase = input<boolean>(false);
  readonly displayId = input<boolean>(true);

  readonly name = computed(() => {
    const name = this.term().name;
    return (Array.isArray(name) ? name[0] : name) || this.term().displayName;
  });
  readonly id = computed(() => this.term().identifier || this.term().accession);

  constructor() {}
}
