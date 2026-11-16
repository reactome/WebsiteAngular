# Quickstart: proving the steps (SC-005)

Every step is shown on a **private test copy** before the host, in its success path, its failure path and an
interruption part way. The test copy never touches the serving graph: it is a scratch data folder, a spare
loopback port, a test password, and a state folder of its own.

## Prerequisites

- Docker and Compose 2.40; `jq`; about 6 GB free (one copy of the store plus the step's own copy).
- A copy of a release's store folder as it is delivered (the store alone, no transaction logs), made by reading
  the files; no query to the serving graph.
- `graph.sh` pointed at the test copy by its settings (data folder, state folder, port, project name, and stand-in
  service checks), never at the host's defaults.

## Runs

| #   | Run                                                                                                    | Expect                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cutover` onto the copy at 4.3.6                                                                       | online, release answered, no file changes owner, `status` consistent                                                             |
| 2   | `release` with a store delivered without logs                                                          | the allowance run, then standing; release, counts and services checked                                                           |
| 3   | `release` with a store from a newer Neo4j (format) or another major                                    | refused before any change, the old store serving (US1 AS 2)                                                                      |
| 4   | `release` where a service check fails (a stand-in answering the old release)                           | the old database back, services restarted on it and checked (US1 AS 3)                                                           |
| 5   | `release` with a store from an older 4.x                                                               | opened with store upgrade for one start (US1 AS 4)                                                                               |
| 6   | `release` with a store missing most of its nodes, then again with `--shrink-expected`                  | refused by the counts; then accepted and reported (US1 AS 5)                                                                     |
| 7   | `release` killed after `set-aside`, and after `store-in-place`                                         | the graph does not start; `status` names the step; `rollback-release` (or the step again) brings back a checked graph (US4 AS 3) |
| 8   | `apply` 4.3.6 → 4.4.48                                                                                 | the copy taken; `dbms.components` 4.4.48, `upgradeStatus` CURRENT; standing configuration has no allowance                       |
| 9   | `rollback-apply` after run 8                                                                           | the copy and 4.3.6 back; 4.3.6 starts (it would not over the upgraded system database, research R2)                              |
| 10  | `apply` interrupted after the copy                                                                     | as run 7                                                                                                                         |
| 11  | A merged `graph.json` change not applied; `docker compose up -d`, `up -d graphdb`, a container restart | still the applied image; `status` reports pending (US4 AS 2, US3 AS 4)                                                           |
| 12  | `graph.json` set to another major; `apply`                                                             | refused (FR-008)                                                                                                                 |
| 13  | `rollback-cutover` with a stand-in host service                                                        | the host service back, the owner unchanged                                                                                       |
| 14  | `cutover` where the check fails, and `cutover` interrupted after its copy                              | `rollback-cutover` runs, or is named by `status`; the host service serves again                                                  |
| 15  | `rollback-release` where a service still fails on the restored database                                | stops and reports, the restored database serving; no loop                                                                        |
| 16  | `rollback-apply` interrupted part way, then run again                                                  | completes; 4.3.6 serves                                                                                                          |
| 17  | Two steps started at once                                                                              | the second refused at once (the lock)                                                                                            |
| 18  | `rollback-apply` after a later `release`                                                               | refused: rollbacks only for the last step                                                                                        |
| 19  | A misspelt setting in `graph.json`, applied                                                            | the start fails (strict validation); `rollback-apply` restores                                                                   |
| 20  | `:previous` removed by hand; `status`                                                                  | reported missing                                                                                                                 |

## On the host (run with sudo by the person who holds it)

1. `status`: before anything, what serves and what the repository says.
2. `cutover` (4.3.6, the store's version), then `status`; the services each answer the release.
3. After it has served a while: `retire`.
4. On release day: `release <folder>`, then spec 011's cache purge and warm-up.
