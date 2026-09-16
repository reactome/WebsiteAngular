# Research: Interactor confidence filtering and download

Everything below was read out of the code or measured against a running service.
Nothing here is inferred from the feature description.

## 1. The score is already there, and it is 0–1

`/ContentService/interactors/static/molecule/{acc}/details` returns a `score` on
every interaction. Measured against the local ContentService for **Q13158**
(FADD): **33 interactions, scores 0.482 – 0.98**.

`interactors-table.component.ts:62` already lists `score` among its displayed
columns, so the number is one curators have seen before.

**Decision**: no new data source and no service change for the data itself.

## 2. The threshold is per resource, and its default is 0.45

Read from `reactome/pwp-diagram`,
`src/main/java/org/reactome/web/diagram/data/InteractorsContent.java`:

```java
static final double DEFAULT_SCORE = 0.45;
static Map<String, Double> interactorsThreshold = new HashMap<>();
```

Keyed by **resource**, not by entity and not globally.

This app already models resources: `InteractorService.currentResource =
signal<ResourceAndType>(…)` with `ResourceType` STATIC / PSICQUIC / CUSTOM
(`projects/pathway-browser/src/app/interactors/`).

**Decision**: one threshold in force at a time, belonging to the current
resource. **Alternative rejected**: a global threshold — it would carry a score
from IntAct across to a resource where the number means something else.

## 3. The interactors are already in memory

`InteractorService.addInteractorNodes()` reads
`occurrenceNode.data('interactors')` — the fetched array is stored on the
cytoscape node that owns it.

**Decision**: filtering and export both read the graph. Neither needs a request.

**This corrects an assumption carried into planning.** `FileDownloadService` and
`ManagedDownloadDirective` were suggested for the download, but they exist for
_server_ downloads — progress, cancellation, a 180s ceiling, a failure reason
from an HTTP response. An in-memory export has none of those states: there is
nothing to wait for and nothing to fail.

**Consequence for the spec**: FR-011 ("MUST tell the curator while the download
is being prepared, and MUST tell them if it fails") is close to vacuous for a
synchronous export. It is kept only in the weaker, honest form — the export must
not silently produce an empty or partial file — and the plan records why the
progress machinery is not reused. Using it anyway would add a spinner that never
spins.

## 4. The file format: TSV, matching the existing participant export

Both formats exist in this repo, so the question is which precedent applies:

| Export                                                             | Format  | Produced by                                 |
| ------------------------------------------------------------------ | ------- | ------------------------------------------- |
| `molecule-download-table.component.ts` — participating molecules   | **TSV** | client-side, from a table already on screen |
| `download-tab.component.ts` — analysis results, mapping, not-found | CSV     | the analysis service, server-side           |
| `idg-page.component.ts`                                            | CSV     | client-side                                 |

The interactor download is the first kind: a table already on screen, exported
client-side, from the details panel. `molecule-download-table` is its direct
analogue and produces
`Participating Molecules [R-HSA-109606].tsv` with `text/tab-separated-values`.

**Decision**: TSV, named for the entity and resource it came from. **Rationale**:
scores and gene names are safe in TSV without quoting, curators already receive
one TSV from this panel, and matching the neighbouring feature beats matching the
server-generated ones.

**One thing not to copy from it**: it does
`a.href = URL.createObjectURL(blob)` and never revokes. `FileDownloadService`
revokes after 60s, and the new export should do the same.

## 5. A threshold that survives a reload has to be in the URL

`UrlStateService` (`projects/pathway-browser/src/app/services/url-state.service.ts`):

- params are declared in `values` via `urlParam<T>(initialValue, type, otherTokens?, otherTransform?)`;
- the reader **resets any param the URL does not mention** to its initial value;
- the writer replaces the whole query string when state settles.

So a signal alone is undone within the same turn — demonstrated twice while
mapping `#TOOL=AT` in #191.

**Decision**: a `number` param, initial value `0.45`. Because
`currentQueryParams()` omits any value equal to its `initialValue`, a threshold
left at the default is **absent from the URL** — which is exactly FR-007 ("MUST
apply the default and MUST NOT be rewritten to name it"), obtained from the
existing mechanism rather than from special-casing.

**Consequence**: the default cannot differ per resource without a second
mechanism, because a `urlParam` has one initial value. Per-resource _memory_
(FR-004a) therefore lives in the service — a `Map<string, number>` mirroring the
old browser — while the URL always carries the threshold in force. Switching
resource writes that resource's remembered threshold into the same param.

**Alternative rejected**: one param per resource (`?threshold.IntAct=`). It
multiplies params, cannot be typed, and no shared link would survive a resource
rename.

## 6. Where the control goes

FR-001 says beneath the diagram. The analysis form already occupies that region
as a `.dropdown` inside the `as-split-area` in `viewport.component.html`, opened
from `dropdown()`. The interactor control is not a dropdown — it is visible
whenever interactors are shown — so it is a sibling of the diagram, not another
dropdown state.

**Decision**: a `cr-interactor-threshold` component rendered in the viewport under
the diagram, with `@if` on "interactors are currently shown".

**Open, and deliberately left to implementation**: what exactly "interactors are
currently shown" reads from. The candidates are `currentResource()` being
non-null and the graph holding interactor nodes; the second is what the reader
can see, so it is the one to prefer under constitution principle I.
