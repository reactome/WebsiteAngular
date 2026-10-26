# Data model: One API contract

The shapes the contract holds first, with each field's source and kind. Fields are written as the service writes them (`search-core.ts`, reproducing Java): **a value that is null, empty text or an empty list is left out, but `false` is written**. A field is _required_ in a kind when the indexer always gives that kind a non-empty value and every recorded entry of the kind carries it. Otherwise it is optional. The "required" marks below are from the recordings; each is rechecked against the builder when its kind is written, and becomes optional where the builder can leave it out.

Sources: the indexer's documents (`IndexDocument`, `IconDocument`, `DeletedDocument`, `PersonDocumentBuilder`, `InteractorDocumentBuilder`), through the Solr schema. Recorded counts are distinct entries in `e2e/har/` (see [research.md](research.md) R2).

## Shared scalar aliases

| Alias         | Kind                                               | Why named                                                              |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `Long`        | integer, `format: int64`, written exactly          | A Java long, which may exceed 2^53 (the replacement ids)               |
| `EpochMillis` | integer                                            | A date written as milliseconds (a deleted entry's `date`)              |
| `Highlighted` | text that may carry `<span class="highlighting" >` | Name, stId, summation, reference name and identifier, from a highlight |

## Search entry (`SearchEntry`): a union of six kinds

Fields every kind carries (`EntryBase`):

| Field       | Kind                    | Required | Source                                                              |
| ----------- | ----------------------- | -------- | ------------------------------------------------------------------- |
| `dbId`      | text                    | yes      | `dbId` (a Solr text field; an accession for interactors)            |
| `id`        | text                    | yes      | `stId`, or `dbId` when there is no stId                             |
| `name`      | `Highlighted`           | no       | `name`, or its highlight; none when a highlight has no name snippet |
| `type`      | text, narrowed per kind | yes      | `type`                                                              |
| `exactType` | text                    | yes      | `exactType`                                                         |

### Event (`EventEntry`)

`type: "Pathway" | "Reaction"`. A reaction's `exactType` is its category: `"binding" | "transition" | "omitted" | "uncertain" | "dissociation"`. A pathway's is its class.

| Field                                      | Kind          | Required | Notes                                                                   |
| ------------------------------------------ | ------------- | -------- | ----------------------------------------------------------------------- |
| `stId`                                     | `Highlighted` | yes      |                                                                         |
| `species`                                  | text[]        | yes      |                                                                         |
| `summation`                                | `Highlighted` | no       | the document's own, which replaces `inferredSummation` even when absent |
| `isDisease`, `disease`                     | boolean       | yes      | the same value twice                                                    |
| `hasReferenceEntity`                       | boolean       | yes      | always `false`                                                          |
| `hasEHLD`                                  | boolean       | no       | on every pathway (187 of 187)                                           |
| `compartmentNames`, `compartmentAccession` | text[]        | no       | 324 of 450                                                              |
| `fireworksSpecies`                         | text[]        | no       | only on the species-overview routes                                     |

### Physical entity (`EntityEntry`)

`type` is one of "Protein", "DNA Sequence", "RNA Sequence", "Chemical Compound", "Drug", "Set", "Genes and Transcripts", or the name of a physical-entity class that is neither a set nor genome-encoded: Cell, ChemicalDrug, Complex, OtherEntity, Polymer, ProteinDrug, RNADrug and SimpleEntity in release 97. Every reference-entity class has a type of its own. `projects/contract/entity-types.spec.ts` derives the list from the domain snapshot.

| Field                                                 | Kind          | Required | Notes                                      |
| ----------------------------------------------------- | ------------- | -------- | ------------------------------------------ |
| `stId`                                                | `Highlighted` | yes      |                                            |
| `species`                                             | text[]        | yes      | "Entries without species" when it has none |
| `summation`                                           | `Highlighted` | no       | 69 of 1,580                                |
| `isDisease`, `disease`                                | boolean       | no       | 1,546 of 1,580                             |
| `hasReferenceEntity`                                  | boolean       | no       |                                            |
| `compartmentNames`, `compartmentAccession`            | text[]        | no       | 1,546                                      |
| `referenceName`                                       | `Highlighted` | no       | 1,235                                      |
| `referenceIdentifier`, `databaseName`, `referenceURL` | text          | no       | 1,253; the identifier may be highlighted   |
| `fireworksSpecies`                                    | text[]        | no       | only on the species-overview routes        |

### Icon (`IconEntry`)

`type: "Icon"`, `exactType: "Icon"`, `icon: true`.

| Field                                                                          | Kind                   | Required | Notes                                                                                                    |
| ------------------------------------------------------------------------------ | ---------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `stId`                                                                         | `Highlighted`          | yes      |                                                                                                          |
| `species`, `iconName`, `iconCategories`                                        | text / text[]          | no       | the icon's metadata may lack them; an empty name is left out, and still an icon (`icon: true`)           |
| `summation`                                                                    | `Highlighted`          | no       | the icon's description; on a highlighted answer, only from a snippet (icons have no `inferredSummation`) |
| `hasReferenceEntity`, `hasEHLD`                                                | boolean                | yes      | always `false`                                                                                           |
| `iconCuratorName`, `iconCuratorOrcidId`, `iconDesignerName`, `iconDesignerUrl` | text                   | no       | on every recorded icon, but the indexer leaves them out when absent                                      |
| `iconCuratorUrl`, `iconDesignerOrcidId`                                        | text                   | no       | never recorded                                                                                           |
| `iconReferences`, `iconEhlds`                                                  | text[]                 | no       | 39 and 37 of 40                                                                                          |
| `iconPhysicalEntities`                                                         | `IconPhysicalEntity[]` | no       | 27 of 40                                                                                                 |

`IconPhysicalEntity` holds `stId`, `type`, `name`, `compartments` and `displayName`. Each is written from `stId#type#name#compartments`, and an empty part is left out, so every field is optional, `displayName` too (an empty name with blank compartments).

### Person (`PersonEntry`)

`type: "Person"`, `exactType: "Person"`. It has no `stId`, so `id` is the dbId. None is recorded, so this kind follows the builder alone.

| Field                                                                            | Kind   | Required |
| -------------------------------------------------------------------------------- | ------ | -------- |
| `species`                                                                        | text[] | yes      |
| `orcidId`                                                                        | text   | no       |
| `authoredPathways`, `authoredReactions`, `reviewedPathways`, `reviewedReactions` | text   | no       |

### Interactor (`InteractorEntry`)

`type: "Interactor"`, `exactType: "Interactor"`. `dbId` is the accession.

| Field                                  | Kind          | Required |
| -------------------------------------- | ------------- | -------- |
| `stId`, `species`                      | text / text[] | yes      |
| `referenceIdentifier`, `referenceName` | `Highlighted` | no       |
| `databaseName`, `referenceURL`         | text          | no       |
| `fireworksSpecies`                     | text[]        | no       |

### Deleted (`DeletedEntry`)

`deleted: true`. Its `type` and `exactType` are those of the class it was. Every other kind has `deleted?: never`. The generator writes no constraint for a `never` property, so in the schema the live and deleted kinds are kept apart by `additionalProperties: false` (a deleted entry carries `deleted`, which no live kind declares); that setting is load-bearing and stays.

| Field              | Kind          | Required | Notes                                               |
| ------------------ | ------------- | -------- | --------------------------------------------------- |
| `stId`             | `Highlighted` | yes      |                                                     |
| `explanation`      | text          | no       | 3 of 3; none when the deletion has no reason        |
| `date`             | `EpochMillis` | no       | 3 of 3; none when the deletion has no creation date |
| `replacementDbIds` | `Long[]`      | no       | 1 of 3                                              |
| `replacementStIds` | text[]        | no       | 1 of 3                                              |

**Not in the contract** (never written, R2): `regulator`, `regulatedEntity`, `regulatorId`, `regulatedEntityId`, `instanceTypeExplanation`, `reason`.

## Projections

- **`PathwayOfEntry`**: what `/search/pathways/of/{dbId}` answers for `fields=DB_ID,ST_ID,NAME,HAS_EHLD`. It holds `dbId`, `stId`, `id`, `name` and optional `hasEHLD`, with no `type`.

## Answers built on the entry

| Type                                                        | Fields                                                                                 | Routes                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ResultGroup<E>`                                            | `typeName`, `entries: E[]`, `entriesCount`, `rowCount`                                 | inside the grouped results                              |
| `GroupedResult`                                             | `results: ResultGroup<SearchEntry>[]`, `rowCount`, `numberOfMatches`, `numberOfGroups` | `/search/query`                                         |
| `DiagramResult`                                             | the diagram search's answer, with its `found` lists                                    | `/search/diagram/{id}`, `/search/fireworks`             |
| `IconResult`                                                | `ResultGroup<IconEntry>` fields                                                        | `/search/icon/query`                                    |
| `IconEntry`                                                 | one icon                                                                               | `/search/icon/{id}`                                     |
| `FacetCount`, `Facet`, `FacetResponse`, `IconFacetResponse` | as today (spec 013 #676)                                                               | `/search/facet`, `/search/facet_query`, the icon facets |

Each answer's exact field list comes from the service's writer for it, and is checked against the recorded answers when it moves in (R3).

## Validation rules

- **Exactly one kind.** Every recorded entry matches exactly one kind (FR-004). The ajv check reports an entry that matches none, or more than one.
- **What the reader may assume about text.** `Highlighted` fields may hold markup, so a reader that shows them as plain text escapes them.
- **The entity's `type` list is checked.** A test checks it against the domain snapshot's physical entity and reference entity classes, so a new class in a release fails a test, not a page.

## Reader views

- **Site.** `SearchEntry` and `IconEntry` in `projects/website-angular/src/model` become re-exports of the contract's.
- **Pathway browser.** `Search.Entry` and `Search.Icon.Entry` become re-exports, and the namespace keeps only its value `EMPTY_RESULTS`.
- **Narrowing.** A reader that needs one kind narrows on the marker (`type`, `deleted`) instead of declaring its own type.
