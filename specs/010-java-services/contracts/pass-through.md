# Contract: node's pass-through to the Java library service

How content-node forwards a ContentService operation homed in `java-library` ([operation-homes](operation-homes.md)). AnalysisService is routed by nginx and does not go through this ([research R5](../research.md#r5-how-requests-reach-the-java-services)).

## Which requests

- **A declarative table** of the Java-homed path patterns, in content-node, with the service each goes to.
- **It is mounted first,** before CORS, path rewriting and the 404 catch-all, so the Java service sees the request exactly as the reader sent it.
- **A table entry and a node endpoint never match the same URL.** A unit test asserts it, over node's endpoint samples and the routing tests' URLs.
- **Node holds no address for Tomcat.**

## Request, forwarded

| Part                                                                                          | Rule                                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Method                                                                                        | any, unchanged                                                                                               |
| Path and query                                                                                | as received (`originalUrl`), undecoded, matrix parameters kept                                               |
| Body                                                                                          | streamed, not buffered, with no size cap in node. nginx's 64 MB cap and Java's own 50 MiB cap and 413 apply. |
| Host                                                                                          | unchanged. Java builds error `url`s and PDF server names from it.                                            |
| X-Forwarded-For                                                                               | the client address appended                                                                                  |
| X-Real-IP, X-Forwarded-Proto, Range, If-*                                                     | passed through                                                                                               |
| Hop-by-hop headers (Connection, Keep-Alive, TE, Trailer, Transfer-Encoding, Upgrade, Proxy-*) | dropped                                                                                                      |

## Response, returned

| Part    | Rule                                                                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | unchanged                                                                                                                                                                                      |
| Headers | copied verbatim, except hop-by-hop: Content-Type with its charset, Content-Disposition, Content-Length when sent, Cache-Control, ETag, and Java's own CORS headers. Node adds none of its own. |
| Body    | streamed through, not decompressed or buffered                                                                                                                                                 |

## Failure

| When                                                         | Reader gets                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Java service refuses or resets before headers                | `503` with `Retry-After`, in ContentService's JSON error envelope |
| No headers within the timeout (a little under nginx's 300 s) | `504` in the same envelope                                        |
| Fails after headers were sent                                | the connection is closed, so the response is visibly cut short    |
| Reader disconnects                                           | the upstream request is aborted                                   |
| A pooled connection is found stale                           | retried once, to the same service, for GET and HEAD only          |

- **Never:** an answer from another backend, node's own or Tomcat's.
- **Logging:** one log line per failure.

## Shutdown

content-node stops accepting new requests, then waits a bounded time for pass-through requests in flight. The compose stop grace period matches that bound.

## Proof

- **Transparency:** the same request sent through node and straight to the Java service gives identical status, headers (except hop-by-hop) and body bytes, for each class in [research R7](../research.md#r7-parity-per-class-of-operation).
- **Failure:** with the Java service stopped, every Java-homed address answers 503 in the envelope, and no node endpoint is affected.
