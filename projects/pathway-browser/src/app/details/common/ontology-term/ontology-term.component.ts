import { Component, computed, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TitleCasePipe } from '@angular/common';
import { DatabaseObject } from '../../../model/graph/database-object.model';

export type OntologyTerm = DatabaseObject & {
  name?: string[] | string;
  url: string;
  databaseName: string;
  definition?: string;
  identifier?: string;
  accession?: string;
};

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

  readonly name = computed(
    () =>
      (this.term().name instanceof Array ? this.term().name![0] : (this.term().name as string)) ||
      this.term().displayName
  );
  readonly id = computed(() => this.term().identifier! || this.term().accession!);

  constructor() {}
}
