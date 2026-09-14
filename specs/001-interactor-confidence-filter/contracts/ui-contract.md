# UI contract: Interactor confidence filtering and download

This feature exposes no new service API — it reads data already fetched. Its
contract is therefore the surface a reader and a test can address: the URL, the
control, and the file.

## 1. The URL

| Parameter         | Type        | Default | In the address when       |
| ----------------- | ----------- | ------- | ------------------------- |
| `interactorScore` | number, 0–1 | `0.45`  | the reader has changed it |

- Absent means 0.45, and the app **must not** rewrite the address to add it
  (FR-007). This follows from declaring it as `urlParam<number>(0.45, 'number')`:
  `currentQueryParams()` omits any value equal to its initial.
- A value that is malformed, negative or above 1 is replaced by 0.45 and must not
  prevent the pathway or its interactors from opening (FR-008).
- Clearing the interactors removes it from the address (FR-013).

Shareability is the point: the same address opened elsewhere shows the same
interactors (SC-003).

## 2. The control

Rendered beneath the diagram, only while interactors are shown.

| Addressable by                     | Contract                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cr-interactor-threshold`          | present exactly when interactor nodes are on the graph; absent otherwise (FR-002)                          |
| `[data-threshold]` on that element | the threshold in force, so a test can read it without inspecting a slider's pixel position                 |
| its slider                         | `min=0`, `max=1`; changing it updates the URL and the diagram together (FR-003)                            |
| its empty state                    | when the threshold hides every interaction, says so — distinguishably from the entity having none (FR-012) |

**Tests assert on the interactors present on the diagram**, not on the slider's
position and not on the parameter. The control moving is not evidence that
anything was filtered.

## 3. The file

| Property | Value                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| Format   | TSV, `text/tab-separated-values`                                                             |
| Name     | `Interactors [<entity stId>] [<resource>].tsv`                                               |
| Header   | `geneName`, `identifier`, `speciesName`, `entitiesCount`, `evidenceCount`, `score`           |
| Rows     | exactly the interactions currently on the diagram — those at or above the threshold (FR-010) |

- Produced in the browser from data already held; no request is made.
- The object URL is revoked after use, which the existing participant export
  omits to do.
- Because it is synchronous there is no progress and no failure state to report;
  FR-011 reduces to "must not produce a silently empty or partial file", which is
  asserted by comparing the row count against the interactors on the diagram.

## 4. What does not change

- No change to any ContentService request or response.
- No change to how interactors are requested, drawn or cleared.
- No new dbId anywhere: the export names its entity by stable id.
