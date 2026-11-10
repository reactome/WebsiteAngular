# Contract: `GET /ContentService/expression/{id}`

Node only: Java has no such URL (research R3). It is served by `tools/content-node/expression-endpoints.ts`, and its answer type lives in `projects/contract/expression.ts` (types only, per spec 016).

## Request

| Part           | Value                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | a stable id of the selection: a pathway, reaction, complex, set, protein or reference entity (`R-HSA-109606`, `R-HSA-114268`, `uniprot:P10415`, `chebi:30616`), or a dbId, as the service's other `{id}` routes accept |
| query          | none                                                                                                                                                                                                                   |
| trailing slash | `/ContentService/expression/{id}/` is served too (the house rule for node routes)                                                                                                                                      |

The species is the selection's own. For a reference entity, which carries none, the species is its proteins' species.

## Answers

| Status | When                                                             | Body                                                                  |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 200    | heatmap, no genes, or species not available                      | `ExpressionAnswer` (see the type sketch below)                        |
| 404    | unknown id                                                       | the service's error envelope                                          |
| 503    | the expression data directory, or this species' file, is missing | the service's error envelope, saying expression data is not available |

The answer is cacheable at the edge like the service's other answers. It changes only with a release or a refresh of the data.

## Type sketch (final names settled in implementation)

```ts
// projects/contract/expression.ts — types only.
export type Quantiles = [min: number, q1: number, median: number, q3: number, max: number];

export interface ExpressionTissue {
  id: string;
  label: string;
  samples: number;
}

export interface ExpressionExperiment {
  accession: string;
  title: string;
  design: string;
  species: string;
  source: string;
  updated: string;
  fetched: string;
  citation: string;
  licence: string;
  tissues: ExpressionTissue[];
}

export interface ExpressionRow {
  gene: string; // versionless Ensembl gene id
  name: string; // the table's gene name
  values: (Quantiles | null)[]; // one per experiment.tissues entry
  from: { identifier: string; stId: string; displayName: string }[];
}

export type NotShownReason = 'no-gene' | 'not-in-experiment' | 'not-measured';
export interface ExpressionNotShown {
  identifier: string;
  stId: string;
  displayName: string;
  reason: NotShownReason;
}

export type ExpressionAnswer =
  | {
      kind: 'heatmap';
      experiment: ExpressionExperiment;
      rows: ExpressionRow[];
      notShown: ExpressionNotShown[];
      counts: { shown: number; genes: number };
    }
  | { kind: 'no-genes'; experiment: ExpressionExperiment }
  | { kind: 'species-not-available'; species: string };
```

## Repository obligations for the route (CLAUDE.md)

- **`parameters.ts`**: a RECORD entry with `java: null`, a `why`, and `query: []`.
- **Route order**: `fixtures/route-order.json` updated; `registry.ts` adds the family.
- **Routing**: nginx `deploy/nginx/common/routes-core.conf`, an `expression` location to node (regex ending `/?$`, quoted if it holds `;` or `{`), and the dev proxy `proxy.conf.js` row. `deploy/nginx/routes.spec.ts` must pass, and `deploy/nginx/test-config.sh` must be run.
- **Contract**: `projects/contract/routes.ts` gets a row. Run `node tools/contract/generate.ts`, so that `/ContentService/openapi.json` describes the route. Recordings are checked by `tools/api-types/schema.spec.ts`.
- **Docker image**: the compose file mounts `EXPRESSION_FILES` read-only (like `DIAGRAM_FILES`); no path is committed.
- **`boundaries.spec.ts`**: the family imports only shared modules.
