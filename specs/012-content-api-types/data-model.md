# Data model: content API types checked against real answers

These are the records the checks work with. Field lists are what each record must carry; the files are named in [plan.md](plan.md).

## Call (`tools/api-types/calls.mjs`)

One place the site asks the content API for something.

| Field      | Meaning                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`     | Source file, repository-relative.                                                                                                                                                              |
| `method`   | The enclosing method or property (the scan's key, with `file`).                                                                                                                                |
| `http`     | `GET` or `POST`.                                                                                                                                                                               |
| `route`    | Route pattern under `/ContentService`, with `{id}`-style placeholders, e.g. `/data/query/enhanced/v2/{id}`.                                                                                    |
| `query`    | Query values that pick this reader over others of the route that name none (`types=Icon`; `includeRef=true`, or `null` for a parameter never sent), since the shape depends on them.           |
| `type`     | The type the answer is read as, as written in the check's import: e.g. `Jsog<Pathway>`, `PersonEvent[]`, `string[]`. `text` or `blob` for non-JSON answers, which are listed and not compiled. |
| `coverage` | `recordings`, `corpus`, or `gap: <why>`.                                                                                                                                                       |

**Rules**: every call in the source has exactly one entry (by `file`, `method` and its place in the method); every entry has a call in the source; the entry's method and type (`reads`, where the source reads a type parameter its caller chooses) equal the source's.

## Recorded answer (`tools/api-types/answers.mjs`)

| Field    | Meaning                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `key`    | Hash of type and body; identical answers are checked once.                                                  |
| `route`  | Method and normalised path of the request.                                                                  |
| `source` | The HAR file, or the corpus file.                                                                           |
| `call`   | The matching call entry, by route pattern and `params`; none means "not read by the site" (listed, FR-003). |
| `body`   | The answer text, unparsed.                                                                                  |

Answers with status other than 200, without a body (aborted or dropped by the recorder), or non-JSON are counted and listed, never compiled.

## Problem (the check's output)

| Field     | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `route`   | The call's route pattern.                                                                 |
| `answer`  | The recorded answer's key and source.                                                     |
| `path`    | The JSON path of the value the diagnostic points at, e.g. `$.results[0].entries[3].dbId`. |
| `message` | The compiler's message, flattened.                                                        |

Every field an object has that its type does not declare, and every field its type requires that it lacks, is a problem of its own, found by walking each object with the type checker: the compiler alone names only the first extra field of an object, and an extra field hides a missing one, so counting its messages let a type fit worse at the same count (review of #542). Wrong kinds are the compiler's messages.

## Known problems (`tools/api-types/known-problems.json`)

`{ "<method> <route pattern> as <type>": <count> }`, per route and type read, so one reader's progress cannot hide another's regression. A key absent from the file is checked strictly (any problem fails). A route's count failing to go down when fewer problems are found fails too, so the file is kept exact: it is lowered in the pull request that fixes the type, and a route at zero is removed.

## Class mapping (`tools/api-types/snapshot.spec.mjs`)

| Field      | Meaning                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ts`       | The interface, by module and name (resolved declaration, not name).                                                      |
| `java`     | The Java class it models. Its concrete descendants (from the snapshot's `store` labels) are what it is compared against. |
| `view`     | `flatten`, `nested-aggregated`, or `any`: the views whose properties the type must agree with.                           |
| `siteOnly` | For a site-state interface: skipped, with the reason.                                                                    |

**Rules** (research R5): declared and never written → fail; required and not always written, without a recorded answer showing it always present → fail; wrong kind or element class → fail; relationship `type` literal ≠ Java's → fail; written and not declared → listed.

## Projection type

A named type for a route whose answer differs from its class type (research R6), defined once in `model/projections/`, with a comment naming the route and the recorded answer that shows the shape. Fields absent from some recorded answers are optional.
