# Data model: the Java side

> **Amended by [spec 015](../015-graph-exports/spec.md) (24 Oct 2026).** Where this document says otherwise, spec 015 holds:
>
> - **SBML:** the library service's SBML operation uses `sbml-exporter`'s fixed graph-only converter, with its layout drawn from the diagram files. It needs no relational database, and its body is proven by spec 015's comparison rather than byte-identical to the old server's relational answer. Status, headers and errors are still Java's.
> - **BioPAX:** the service gains a BioPAX Level 3 operation through `BioPAX3Exporter`.
> - **Runtime:** the service runs on JDK 17, because BioPAX3Exporter is built for it. Libraries built for Java 11 run there unchanged.
> - **SBML is cut over by spec 015** (its T062–T067, which replace its T044), not here. Since 25 Oct 2026 this service is started in this repository for it (spec 015 research R10).

The entities this feature works with, the rules on each, and how state moves.

## Operation

One published method and path of ContentService or AnalysisService.

| Field        | Rule                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| method, path | as in the service's published API description                                            |
| home         | exactly one of: `node` (ported, or to port), `node-exporter`, `java-library`, `analysis` |
| reason       | one line, by the rule in [operation-homes](contracts/operation-homes.md)                 |
| route state  | see Route state below                                                                    |

Rules:

- An operation homed in `node` is never answered by Java.
- An operation homed in Java is answered only by its own service, or by Tomcat until it is cut over. When its service is down, the reader gets a visible error.

## Java service

| Field         | Library service                                                                            | AnalysisService                          |
| ------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Built from    | a new Reactome repository, with libraries pinned to the commits in research R1             | `reactome/analysis-service` at `9b147e1` |
| Runtime       | Java 11, executable jar                                                                    | Java 11, executable WAR                  |
| Reached by    | node pass-through                                                                          | nginx, directly                          |
| Network       | loopback only                                                                              | loopback only                            |
| Needs         | the graph; the relational release database (SBML); outbound HTTP (PSICQUIC)                | the graph                                |
| Memory budget | heap 1 GiB without the events hierarchy, 3 GiB with it (research R3); set from a load test | heap 3 GiB; set from a load test         |
| Health        | reports health and its build version (pinned commits)                                      | the same                                 |
| Settings      | supplied at run time; none baked into the image                                            | the same                                 |

## State and volumes

| State                                                  | Owner (read-write) | Readers                                                              | Lifetime                                                                                        |
| ------------------------------------------------------ | ------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Overlay-token store                                    | library service    | none                                                                 | as today: an LRU bound of about 2 GB, which deletes files unread for a week only past the bound |
| Analysis result tokens                                 | AnalysisService    | library service (event PDF and events hierarchy with a token)        | as today: the same LRU bound; a missing token within 7 days of its date answers 410, then 404   |
| Analysis data                                          | none (read-only)   | AnalysisService; library service once it serves the events hierarchy | one file per release, mounted read-only; the service restarts to load a new one                 |
| Export cache                                           | library service    | none                                                                 | keyed by database version; disposable                                                           |
| AnalysisService export temp                            | AnalysisService    | none                                                                 | files deleted after 15 minutes; tmpfs                                                           |
| Release files (diagrams, EHLD, fireworks, SVG summary) | none (read-only)   | both                                                                 | per release                                                                                     |

Rules:

- **The overlay-token store keeps its encoding.** Its files are Kryo-encoded, with class names written in. Changing interactor-core, Kryo or the token manager would stop existing tokens reading, so each is frozen; any change requires a migration decided separately.
- **Parity never writes a live store.** It uses throwaway stores, or read-only copies.

## Route state

Each address goes through these states, in order. Each step is reversible by one configuration change.

```text
on Tomcat ──stage──▶ staged in node (inert) ──cut over──▶ on new service ──Tomcat off──▶ final
     ▲                                                          │
     └───────────────────── roll back (one location) ───────────┘
```

- **On Tomcat:** nginx's prefix sends it to Tomcat.
- **Staged:** node's pass-through table knows the address. Nothing is routed to it yet.
- **On new service:** one nginx location sends the address to node, which passes it to the Java service (ContentService). For AnalysisService, nginx sends it to the container. The dev proxy matches.
- **Final:** Tomcat is no longer a target for any address. It is kept, unrouted, through one release.

## Other Tomcat webapps

| Field    | Rule                                                                      |
| -------- | ------------------------------------------------------------------------- |
| Name     | one of the nine besides ContentService and AnalysisService (research R10) |
| Decision | a home (node, a Java service, or static files) or retired                 |
| Evidence | its use measured from access logs before it is decided                    |

Tomcat is not switched off while any of the nine has no decision.
