import { Component, computed, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { NgTemplateOutlet, TitleCasePipe } from '@angular/common';
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

/** Classes whose terms always come from the Gene Ontology. */
const GO_CLASSES = new Set([
  'GO_MolecularFunction',
  'GO_BiologicalProcess',
  'GO_CellularComponent',
  'Compartment',
]);

@Component({
  selector: 'cr-ontology-term',
  imports: [MatTooltip, TitleCasePipe, NgTemplateOutlet],
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

  // The release pipeline fills in databaseName and url, so the curation graph
  // can send a GO term with only its identifier. A GO term's database and link
  // are fixed, so they are rebuilt here rather than leaving an empty href that
  // resolves to the site root.
  private readonly isGo = computed(() => GO_CLASSES.has(this.term().schemaClass));

  readonly databaseName = computed(
    () => this.term().databaseName || (this.isGo() ? 'GO' : undefined)
  );

  readonly url = computed(() => {
    const { url } = this.term();
    if (url) return url;
    const id = this.id();
    return this.isGo() && id ? `https://www.ebi.ac.uk/QuickGO/term/GO:${id}` : undefined;
  });
}
