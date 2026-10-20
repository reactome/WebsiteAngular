# Data model: the content service in modules

## Endpoint

One route the service answers (research R4). It is declared once, in its family's module.

| Field         | Type                                                    | Required | Meaning                                                                                  |
| ------------- | ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `path`        | string                                                  | yes      | The route under `/ContentService`, `{name}` for a path variable.                         |
| `handler`     | `(request) => Promise<Answer>`, may carry `warms: true` | yes      | Answers the request. `warms` means it is called once at start.                           |
| `method`      | `'post'`                                                | no       | Absent: GET (and HEAD).                                                                  |
| `sample`      | string                                                  | no       | The id the parity harness and the invalid-input corpus fill `{id}` with.                 |
| `samplePath`  | `Record<string, string>`                                | no       | Values for path variables other than `{id}`.                                             |
| `sampleBody`  | string                                                  | no       | A POST's body for the harness.                                                           |
| `samplesOnly` | boolean                                                 | no       | The harness uses only `sample`, never the ids it is given.                               |
| `differs`     | `RegExp[]`                                              | no       | Differences from Java this endpoint declares; the harness reports them as intended.      |
| `normalise`   | `(java: unknown) => unknown`                            | no       | A transformation of Java's answer the endpoint's answer is meant to equal.               |
| `unordered`   | `(item: unknown) => unknown`                            | no       | The key by which a list's items are compared when their order is not part of the answer. |
| `deep`        | boolean                                                 | no       | A deep query: it takes a share of the pool (the deep-query limit).                       |

**Validation.**

- An unknown or misspelled field fails the type check, because a family's list is declared `Endpoint[]`.
- A path shared by two endpoints with the same method fails the registry's test.

## Family module

The endpoints of one area of the API, in the order they are matched today, and the helpers only they use.

- It exports one list, `Endpoint[]`.
- It imports only shared modules, never another family and never the registry.

## Shared module

Helpers that more than one family uses, grouped by concern (research R1). They are layered: a shared module imports only the ones above it.

| Layer | Modules                                          |
| ----- | ------------------------------------------------ |
| 1     | `java-text`                                      |
| 2     | `body`                                           |
| 3     | `spring`                                         |
| 4     | `answers`                                        |
| 5     | `objects`                                        |
| 6     | `reference-entities`, `search-params`, `release` |

## Registry

The ordered list of every endpoint: the families' lists, concatenated in today's order.

Everything that needs the list reads it here: routing, `endpointFor`, the parity harness, the invalid-input corpus, the route-table test and the specs.

A test pins the list to today's paths in order, and checks that the 13 order-dependent pairs stay in their recorded order (research R3).

## Server

Start-up and routing. It holds:

- the path rules that come before any route: encoded and doubled slashes, matrix parameters, the trailing-slash 301;
- the download guard;
- failure answering;
- `/health`;
- the PSICQUIC refresh;
- the warm-up.

It imports the registry and the shared modules.
