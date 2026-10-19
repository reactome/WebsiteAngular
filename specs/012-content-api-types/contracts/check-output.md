# Contract: what the checks report

The checks are vitest specs under `tools/api-types/`. Their failure messages are the contract: a developer reading one must be able to find the type and the answer without running anything else.

## The call table check (`calls.spec.mjs`)

Fails with one line per difference:

```text
not in the table: projects/website-angular/src/services/foo.service.ts › getBar (GET /data/bar/{id})
no longer in the source: projects/pathway-browser/src/app/services/baz.service.ts › fetchBaz
read as anything: projects/pathway-browser/src/app/diagram/entity-popup/entity-popup.component.ts › molecules (any)
```

## The compile check (`content.spec.mjs`)

Per route group, fails with one line per problem, sorted:

```text
GET /data/pathways/top/{taxId} as TopLevelPathway[] [<file>.har]: $[3].species[0]: Type 'number' is not assignable to type 'Species'.
GET /data/species/main as Species[] [<file>.har]: $[0]: Property 'shortName' is missing in type 'Species'.
```

and, for the ratchet:

```text
GET /data/species/main as Species[]: 12 problems, known-problems.json allows 9 (more than before)
GET /data/species/main as Species[]: 0 problems, known-problems.json still allows 9 (lower it)
```

It also reports, without failing:

```text
not read by the site: GET /v3/api-docs (1 answer)
skipped: 11 answers without a body, 412 not 200, 18 not JSON
```

## The snapshot check (`snapshot.spec.mjs`)

Fails with one line per mismatch, by type:

```text
Book.ISBN: declared, never written by Book (Java writes isbn)
ExternalOntology.name: string, Java writes List<String> (Disease, Anatomy, CellType, PsiMod, EvidenceType, SequenceOntology)
Relationship.HasModifiedResidue.type: 'modifiedResident', Java's type is 'modifiedResidue'
NegativePrecedingEvent.precedingEvent: element is Event from lib.dom.d.ts, not a graph class
```

Lists without failing: properties written and not declared, per class.
