# Data model: The graph database in a container, its version a setting

## The graph configuration (`deploy/graphdb/graph.json`, in the repository)

| Field           | Meaning                                                               | Rules (checked by `graph.spec.ts`, FR-012)                                                                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `neo4j.version` | The version to run, e.g. `4.3.6`                                      | Not older than `releaseBuild`; same major.                                                                                                                                                                                                                                                                                |
| `neo4j.image`   | `neo4j:<version>-community`                                           | Its tag names `neo4j.version`.                                                                                                                                                                                                                                                                                            |
| `neo4j.digest`  | The image's `sha256:` digest                                          | Present; 64 hex characters.                                                                                                                                                                                                                                                                                               |
| `releaseBuild`  | The version releases are built with, recorded by hand when it changes | Present.                                                                                                                                                                                                                                                                                                                  |
| `plugins[]`     | `{ name, version, url, sha256 }`                                      | Each field present; `sha256` 64 hex; the version is for `neo4j.version`'s minor (APOC `4.3.x.y` for 4.3).                                                                                                                                                                                                                 |
| `settings`      | Neo4j settings, by name                                               | Present: `dbms.default_database=graph.db`, Bolt on all interfaces inside the container (the port is published on loopback only), heap and page cache, `dbms.security.procedures.unrestricted` for the plugins, `dbms.config.strict_validation=true`. Absent: `dbms.allow_upgrade`, `dbms.recovery.fail_on_missing_files`. |

The first version: 4.3.6, digest from research R2, APOC 4.3.0.12 (sha256 from R2), the settings the host
installation runs with (read from it in the first task).

## The applied configuration (on the host, written only by the steps)

The image name below is the default; it is one of the steps' settings, so a test copy has its own.

- **`reactome-graphdb:applied`**, a local image built from `graph.json` at a commit: the base image by digest, the
  plugins checked, the settings (in a file the image's user can write), the wrapper, `USER` set to the data folder's
  owner (so the image is specific to its host), and a label naming it as this graph's. **`reactome-graphdb:previous`** is the one
  it replaced.
- **`applied.json`** in the state folder: the `graph.json` content applied, its commit, the time, the image id.

`status` compares `applied.json` with `graph.json` at the working tree's commit: equal, or "pending: run apply"
(US3 AS 4).

## The step state (`state.json`, in the state folder)

```text
{ step, startedAt, phase, from, to }
```

- `step`: `release` | `apply` | `rollback-release` | `rollback-apply` | `cutover` | `rollback-cutover` | `retire`.
- `phase`: the last change made, written **before** each change to the data folder or the applied configuration
  (FR-010a): `copied`, `set-aside`, `store-in-place`, `allowance-run`, `standing`, `services-restarted`, `checked`.
- Absent when no step is under way. While present, the wrapper refuses to start the graph, naming the step, and
  `status` says which rollback undoes it or that the step can be run again.

## The rest of the state folder

- `steps.env`: the steps' settings (absolute paths, service URLs, the Tomcat restart command); written once by
  hand, never from `~` (research R9).
- `history.json`: each completed step, in order; a rollback is allowed only for the last.
- `lock`: the `flock` every step but `status` holds.
- `logs/`: one log per step run, with the captured container logs.

## The set-aside database and the data copies (in the state folder)

- **Set-aside database** (`set-aside/`): `databases/graph.db` and `transactions/graph.db` that served before the
  last release step, with the counts taken from them while they served (`counts.json`: events, physical entities,
  species, release). Replaced by the next release step (FR-006).
- **Data copy** (`copies/<time>/`): the whole data folder, taken before an apply or the cut-over; the last one is
  kept, older ones removed once a step has succeeded.

## State transitions of the serving graph

```text
host installation ──cutover──▶ container (applied) ──apply──▶ container (applied', previous kept)
        ▲                          │      ▲                         │
        └──rollback-cutover────────┘      └────rollback-apply───────┘
container ──release──▶ container (new store; old one set aside) ──rollback-release──▶ container (old store)
container ──retire──▶ (host package removed; rollback-cutover no longer possible)
```
