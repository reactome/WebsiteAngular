# Contract: caching labels on content API answers

This applies to every answer node gives under `/ContentService/`. Java's answers, and those of the AnalysisService, are not changed.

## Headers

| Situation                                                                                                                                                         | `Cache-Control`                           | `X-Cache-Rule`     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------ |
| A GET or HEAD in standard form, answered 200                                                                                                                      | `public, max-age=3600, s-maxage=31536000` | `standard`         |
| A `token` query parameter, whatever else holds                                                                                                                    | `private, no-store`                       | `token`            |
| An endpoint marked private                                                                                                                                        | `private, no-store`                       | `endpoint`         |
| An endpoint marked never cached                                                                                                                                   | `no-store`                                | `endpoint`         |
| Any status other than 200 (304 excepted)                                                                                                                          | `no-store`                                | `status`           |
| POST, OPTIONS, or any other method                                                                                                                                | `no-store`                                | `method`           |
| A query parameter that is undeclared, repeated (not a list) or has an invalid value                                                                               | `no-store`                                | `parameter:<name>` |
| A path variable not in a standard form                                                                                                                            | `no-store`                                | `path:<variable>`  |
| A fixed part of the path not in standard form (encoded letters)                                                                                                   | `no-store`                                | `form`             |
| Answered before reaching an endpoint: the Tomcat-style 400, Spring's 404 for `//` or a raw `;`, the catch-all 404, a 405, a deep-query 503, an unexpected failure | `no-store`                                | `default`          |

A 304 from Express keeps the label of the 200 it stands for.

The API page roots (`/ContentService`, `/ContentService/`, `/AnalysisService`, `/AnalysisService/`) are served by the site server, not node, and send `Cache-Control: no-store`.

## Invariants

- No answer under `/ContentService/` that node writes is without a `Cache-Control` header.
- A label never changes the status or body. Every ported endpoint stays byte-identical to Java (spec FR-007).
- `public` is given only to a 200 on GET or HEAD.

## What the Cloudflare Cache Rule must be (outside this repo; issue #527)

- **Eligible for cache:** `/ContentService/*`, leaving out the four root paths.
- **Edge TTL:** use the `Cache-Control` header if present. **Browser TTL:** respect origin.
- **No status-code TTL.**
- **Cache key:** sort the query string.
- **Smart Tiered Cache:** on.
- **Release day:** purge by prefix, `/ContentService/`.
