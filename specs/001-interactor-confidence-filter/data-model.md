# Data model: Interactor confidence filtering and download

No persisted storage and no new service payload. Everything here is state already
in the browser, plus one value in the URL.

## Interaction

What the interactor service fetches and stores on the cytoscape occurrence node
that owns it, as `occurrenceNode.data('interactors')`.

**These are the fields the graph actually carries**, read off a running diagram on
2026-09-14 (R-HSA-1368108, IntAct, first occurrence node, 11 interactions):

| Field                    | Type   | Notes                                                        |
| ------------------------ | ------ | ------------------------------------------------------------ |
| `score`                  | number | 0–1. The only field this feature reads to decide visibility. |
| `acc`                    | string | The accession. Identifies the interactor in the export.      |
| `alias`                  | string | The readable name, where there is one.                       |
| `id`                     | string | The interaction's own id.                                    |
| `evidences`              | number | How much support there is.                                   |
| `accURL`, `evidencesURL` | string | Links out; not exported.                                     |

An earlier draft of this document listed `identifier`, `geneName`, `speciesName`,
`entitiesCount` and `evidenceCount`. Those are the **details-panel table's**
fields, from a differently shaped response, and none of them is on the graph. The
export reads the graph, so it uses the list above.

**Validation**: an interaction with no `score` was not seen in the measured data.
If one arrives it is treated as **below every threshold** — hidden rather than
shown — because a claim with no confidence behind it is the one a curator raising
the threshold is trying to remove. Asserted in `interactor-threshold.spec.ts`.

## How interactors reach the diagram

Two steps, which matters because a test has to perform both before there is
anything to filter:

1. Choosing a resource adds **occurrence** nodes — class `InteractorOccurrences`,
   the badges carrying a count. Measured: 9 of them, taking the graph from 112 to
   121 elements.
2. Clicking one draws **that entity's** interactors — class `Interactor`.
   Measured: the first occurrence's 11 interactions took the graph from 121 to 143.

So `cy.elements('.Interactor')` is the count an assertion reads, and it is zero
until step 2. An earlier draft of the plan said `.interactor`, lower case, which
matches nothing.

## Confidence threshold

The lowest score a curator wants to see.

| Property                 | Value                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Type                     | number, 0–1                                                                                        |
| Default                  | **0.45** — `DEFAULT_SCORE` in `pwp-diagram`'s `InteractorsContent.java`                            |
| Scope                    | one per interaction resource                                                                       |
| Lives in                 | the URL, as a `urlParam<number>` with initial value 0.45                                           |
| Absent from the URL when | equal to 0.45, because `currentQueryParams()` omits a value equal to its initial — which is FR-007 |

**Clamping**: a value outside 0–1, or one that does not parse, falls back to 0.45
rather than blocking the pathway from opening (FR-008). The clamp is a pure
function so it can be tested against the hand-edited addresses FR-008 describes.

**Per-resource memory**: a `Map<string, number>` on `InteractorService`, keyed by
resource name, mirroring `interactorsThreshold` in the old browser. Switching
resource writes that resource's remembered value into the single URL param.
Session-only; the old browser also forgets on reload.

## Interaction resource

Already modelled: `InteractorService.currentResource = signal<ResourceAndType>`,
where `ResourceType` is STATIC, PSICQUIC or CUSTOM. This feature adds no fields —
it uses the resource's **name** as the key for the threshold map.

## Shown interactor set

Derived, not stored: the interactions of the entities whose interactors were
requested, with `score >= threshold`. It is what the diagram draws and exactly
what the export writes (FR-010).

**State transitions** that must hold:

| From                 | Event                                  | To                                                                                                    |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| no interactors shown | reader opens interactors for an entity | shown at the threshold in force; control appears                                                      |
| shown                | threshold raised above some scores     | those interactions leave the diagram; the rest stay                                                   |
| shown                | threshold lowered to 0                 | every interaction the resource returned is on the diagram                                             |
| shown                | threshold above every score            | nothing drawn, and the control says the threshold is hiding them — distinct from having none (FR-012) |
| shown                | resource switched                      | that resource's remembered threshold applies, not the previous one (FR-004a)                          |
| shown                | interactors cleared                    | control and export go; the param leaves the URL (FR-013)                                              |

## Export row

One line of TSV per interaction currently shown.

Columns, in the order the interactors table already presents them, so the file
matches what the curator was looking at: `geneName`, `identifier`,
`speciesName`, `entitiesCount`, `evidenceCount`, `score`.

Filename follows the existing participant export
(`Participating Molecules [R-HSA-109606].tsv`), naming the entity and the
resource: `Interactors [<entity stId>] [<resource>].tsv`.
