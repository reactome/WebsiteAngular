# Data model: Cache headers for the content API

There is nothing stored. These are the records the code keeps, and the value it computes per request.

## Endpoint parameter record

There is one entry per GET endpoint of the node content service, keyed by node's endpoint path (`/ContentService/data/query/{id}`). The full shape is in [contracts/parameter-record.md](contracts/parameter-record.md).

| Field   | Meaning                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `java`  | The documented operation it answers for, as the published API description names it, or `null`                                                                                              |
| `why`   | Required when `java` is `null`: why there is no documented operation                                                                                                                       |
| `path`  | For each path variable, its kind (`oid`, `taxId`, `person`, `className`, `attribute`, `resource`, `accession`, `goId`, `iconId`, `pubmedId`, `text`)                                       |
| `query` | For each declared query parameter: `type` (`bool`, `int`, `enum`, `text`, `list`), `default`, `required`, `min`/`max`, `values`, and `ignored` (declared by Java, no effect on the answer) |
| `cache` | Omitted when the endpoint follows the normal rule; `'never'` or `'private'` otherwise (research R5)                                                                                        |

**Validation**:

- **Keys:** the record's keys are exactly node's GET endpoints, so no endpoint is missing and none is extra.
- **Agreement with Java's description:** for each entry with a `java` operation, the query parameter names, types and defaults equal those in the snapshot of Java's published description.
- **Undocumented endpoints:** every `java: null` entry has a `why`.

## Caching label

The label is computed per request, and only from the request as sent and the answer's status. It never looks at the body.

| Label        | `Cache-Control`                           | Given when                                                                                                                                                                            |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheable`  | `public, max-age=3600, s-maxage=31536000` | All of these hold: the method is GET or HEAD; the status is 200; there is no `token`; the endpoint's `cache` is not set; and the path and query are in standard form for the endpoint |
| `not-stored` | `no-store`                                | Anything else                                                                                                                                                                         |
| `private`    | `private, no-store`                       | The request has a `token` query parameter, or the endpoint's `cache` is `'private'`                                                                                                   |

**The rule that applied** goes out as `X-Cache-Rule`:

| Rule               | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `standard`         | Cacheable: every check passed                                      |
| `redirect`         | A `301` from a trailing-slash URL to the one without it            |
| `method`           | The method is not GET or HEAD                                      |
| `status`           | The status is not 200                                              |
| `token`            | The request has a `token` query parameter                          |
| `endpoint`         | The endpoint is marked never cached                                |
| `parameter:<name>` | The named query parameter is undeclared, repeated or invalid       |
| `path:<variable>`  | The named path variable is not in a standard form                  |
| `form`             | The rest of the path is not in standard form, e.g. encoded letters |
| `default`          | The answer never reached an endpoint                               |

**Transitions**: none. The label is a pure function of the request and its status.

## Warm-up list

The warm-up list is an ordered list of standard-form URLs, built at run time from:

- the species list;
- the release's top-level pathways for each species;
- the fixed content lists.

Every URL it requests must itself be labelled `cacheable`, which is checked as it runs.
