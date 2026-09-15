# Quickstart: validating interactor confidence filtering and download

How to prove the feature works, end to end, on a running app. Details of the
surface are in [contracts/ui-contract.md](./contracts/ui-contract.md); the
entities are in [data-model.md](./data-model.md).

## Prerequisites

A backend that answers `/ContentService/interactors/...`. On the dev host the
local Tomcat does; otherwise point at production:

```bash
REACTOME_BACKEND=https://reactome.org npm run start:simple
```

Use an npm script, not a bare `ng serve` — the CMS content is generated, and a
bare serve produces a site with empty content pages and no warning.

## A worked entity

**Q13158 (FADD)** returns 33 interactions scoring **0.482 – 0.98**, measured
against the local ContentService. That spread straddles the 0.45 default and has
values on both sides of 0.6, which makes it a good subject: raising the threshold
to 0.6 must visibly remove some and keep others.

```bash
curl -s "http://localhost:8080/ContentService/interactors/static/molecule/Q13158/details" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); s=[i['score'] for i in d['entities'][0]['interactors']]; print(len(s), min(s), max(s))"
```

Re-run that before trusting any count below: the data moves between releases, and
a figure you did not measure is not a figure.

## Scenario 1 — filtering (FR-003, FR-004; SC-001, SC-002)

1. Open a pathway containing that entity and show its interactors.
2. The control appears beneath the diagram. Read the count of interactor nodes on
   the graph, not the control:

   ```js
   document.querySelector('#cytoscape')._cyreg.cy.elements('.interactor').length;
   ```

3. Raise the threshold to 0.6. The count drops, and equals the number of
   interactions scoring ≥ 0.6.
4. Lower it to 0. Every interaction the resource returned is on the diagram.
5. Raise it above the highest score. Nothing is drawn, and the control says the
   threshold is hiding them — not that there are none (FR-012).

**The count on the graph is the measurement.** A slider that moved proves
nothing.

## Scenario 2 — sharing (FR-006, FR-007; SC-003)

1. With a threshold set, copy the address. It carries `interactorScore`.
2. Open it in a new session: the same interactors are shown.
3. Set the threshold back to 0.45 and look at the address — `interactorScore` is
   **gone**, because a value equal to its initial is omitted. A default nobody
   chose does not belong in a reader's address.
4. Hand-edit it to `interactorScore=banana` and reload: the pathway and its
   interactors still open, at 0.45 (FR-008).

## Scenario 3 — resource memory (FR-004a)

1. Set a threshold on one resource.
2. Switch resource, set a different one.
3. Switch back: the first resource's threshold is the one in force, not the
   second's.

## Scenario 4 — the download (FR-009, FR-010; SC-004)

1. With a threshold hiding some interactions, download.
2. The file is `Interactors [<stId>] [<resource>].tsv`.
3. Its row count equals the interactor count on the graph — not the count the
   resource returned. That equality is the assertion; a file that merely exists
   is not evidence.
4. Every row carries a score, and none is below the threshold.

## Gates

```bash
npm test && npm run check:types && npm run check:lint && npm run check:dead && npm run format:check
npm run e2e -- e2e/interactor-threshold.spec.ts
```

## Before this is done

`RELEASE-TESTING.md:117` and `:118` move from **missing** to **auto**, each naming
`e2e/interactor-threshold.spec.ts`, and the two matching gaps leave
`CURATOR-REPORT.md:225-229`. A row may only be called **auto** once a named spec
asserts it.
