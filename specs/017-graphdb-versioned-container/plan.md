# Implementation Plan: The graph database in a container, its version a setting

**Branch**: `spec017/plan-2` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/017-graphdb-versioned-container/spec.md`

## Summary

The graph runs from the vendor's Neo4j Community image over the host's Neo4j data folder, as the folder's owner.
What it runs is described in one reviewed file, `deploy/graphdb/graph.json`: the version (tag and digest), the
version releases are built with, the plugins pinned by version and sha256, and the settings. A merged change to
that file reaches nothing until a step applies it: the apply step builds a local image, `reactome-graphdb:applied`
(keeping `:previous`), and the compose service names only that tag, in a profile, so that no `docker compose up`,
restart or reboot changes what serves (research R3).

One bash script, `deploy/graphdb/graph.sh`, run with sudo, carries the steps: `status`, `release`, `apply`, the
three rollbacks, `cutover` and `retire`. The two one-start allowances (no transaction logs, store upgrade) go only
to a separate run of the applied image that is never restarted (R1, R2). A release is brought up from the folder it
is delivered in: the serving database is set aside with its logs, the new store opened once with the missing-logs
allowance, then started standing and checked by database status, release number and counts; content-node, Tomcat
and java-library are restarted and each checked (R5). Everything is shown on a private test copy, in its success,
failure and interrupted paths, before the host.

Measured on the way: a newer minor version (4.4.48) upgrades the system database irreversibly on its first start
even with no store upgrade allowed, after which 4.3.6 will not start (R2); and java-library held the previous
release in memory until restarted (R5).

Revised after the plan's review (#723, research R9): the steps hold a lock, keep a log, refuse rollbacks out of order,
copy only with Neo4j stopped, give a delivered store the folder's owner, read their settings from the state folder
(never from `~` under sudo), pass the password only in a container's environment, and refuse a store the server
cannot read before changing anything (`neo4j-admin store-info`). The wrapper is baked into the applied image and
lets a step's own starts through. The image is built with the legacy builder (no BuildKit on the host), keeps its
configuration file writable, and validates settings strictly.

## Technical Context

**Language/Version**: bash 5 for the steps and the wrapper (they run as root, where Node 24 is not on the path);
TypeScript ~5.9.3 under vitest for the specs.

**Primary Dependencies**: the vendor's `neo4j` Community images (4.3.6 first, by digest); APOC per minor version,
fetched on the host with `curl` and checked by sha256; Docker 29 with Compose 2.40 and the legacy builder (no
buildx); `jq`, `curl` and `flock` on the host. No npm dependency is added.

**Storage**: the host's Neo4j data folder (bind-mounted); a host state folder for the applied configuration, the
step state, the counts, the set-aside database and the data copies.

**Testing**:

- vitest specs with stub `docker`, `systemctl` and `curl` on `PATH` (the `entrypoint.spec.ts` pattern), for every
  path of every step;
- `graph.spec.ts` (FR-012) and a rewritten `compose.spec.ts`, each check seen failing once;
- the test-copy runs of SC-005 against the real images on a spare loopback port (quickstart.md).

**Target Platform**: the Linux host that serves the site, with Docker and systemd; the graph's Bolt port on its
loopback interface.

**Project Type**: deployment configuration and operational scripts in an existing web application repository.

**Performance Goals**: a release step under 10 minutes (SC-001): the allowance start (about 1 minute on the
copy), the counts (about 2 s), and the service restarts, of which Tomcat is the longest.

**Constraints**:

- one Neo4j on the port at any time; the standing configuration never allows store upgrade or a start without
  logs;
- no load on the serving graph beyond the checks named in FR-013;
- every test of Neo4j's behaviour on a private copy, never the serving graph;
- disk: a data copy, a set-aside database and a delivered store together take about three times the data folder,
  so each step checks room for what it writes, plus images, plus a margin, and refuses otherwise;
- the repository is public: no host names, credentials or internal release process.

**Scale/Scope**: one host; one graph of 2.5 GB; four services that read it; eight subcommands.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Verify the instrument.** Passed by design, from measurement: Neo4j logs `Started.` with `graph.db`
  offline, so no step trusts it; each check reads the database's status, its release number, and each service's
  own answer (R1, R5). A service answering the old release is caught by asking it, not the graph.
- **II. Measure in the thing.** Every Neo4j behaviour the design relies on was measured on a private copy (R1,
  R2, R4); the one not yet explained (the allowance run's status) is carried as an open item and the design does
  not rest on it. The steps are shown on a test copy against the real images before the host (SC-005).
- **III. Prove a test fails.** Each check in `graph.spec.ts` and `compose.spec.ts`, and each failure path of the
  steps, is shown failing once; the stand-in runs are part of each task.
- **IV. Stable identifiers.** Not touched.
- **V. Comments carry the failure.** The scripts' comments name what went wrong without each guard (the
  `Started.`-but-offline graph, the system database upgraded by a newer minor, the service that kept the old
  release).
- **Quality gates.** The specs run in `npm test`; nothing touches the site's build or its e2e.
- **FR-013.** Besides the login, release number, counts and services' answers, the steps read Neo4j's own state on
  the system database (`SHOW DATABASE`, `dbms.components()`, `dbms.upgradeStatus()`): no load on the graph, which is
  what FR-013 limits.

No violations. Re-checked after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/017-graphdb-versioned-container/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R8, measured
├── data-model.md        # graph.json, the applied configuration, the step state
├── quickstart.md        # the test-copy runs (SC-005) and the host order
├── contracts/
│   ├── graph-json.md    # the configuration file's fields and rules (FR-012)
│   └── graph-sh.md      # the steps: subcommands, outputs, exit codes
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
deploy/graphdb/
├── graph.json           # new: the configuration to run (FR-001, FR-003, FR-004)
├── Dockerfile           # new: the applied image, built by the apply step from graph.json
├── graph.sh             # new: status | release | apply | rollback-release | rollback-apply
│                        #      | cutover | rollback-cutover | retire   (run with sudo)
├── graph.spec.ts        # new: FR-012 over graph.json
├── graph-sh.spec.ts     # new: the steps with stub docker/systemctl/curl
├── entrypoint.sh        # kept; refuses to start while a step is under way
├── entrypoint.spec.ts   # extended for that refusal
└── compose.spec.ts      # rewritten for the profile, the applied tag, the bind mount
docker-compose.yml       # graphdb: profile, reactome-graphdb:applied, bind mount, no volume
README.md                # the stack's start and the graph's steps
RELEASE-TESTING.md       # the release step before the cache purge and warm-up (spec 011)
```

**Structure Decision**: everything lives beside the existing graph files in `deploy/graphdb/`, as the wrapper and
its specs do today. Bash for what runs as root (R6); TypeScript only in the specs.

## Order of work

1. **The configuration file and its check** (US3): `graph.json` at 4.3.6 with APOC 4.3.0.12 and today's settings;
   `graph.spec.ts`, each rule seen failing.
2. **The applied image and the compose service** (US4): the Dockerfile; compose's `graphdb` in a profile on
   `reactome-graphdb:applied`, bind mount, no volume; `compose.spec.ts` rewritten; the wrapper's refusal while a step
   is under way (with the step's own bypass), baked into the image; the stop grace period. Nothing on the host
   changes yet.
3. **`graph.sh status` and `apply`** (US2, US3 AS 4), with stubs, then on the test copy: apply 4.3.6, apply 4.4.48
   and back by `rollback-apply`, and an apply interrupted.
4. **`graph.sh release` and `rollback-release`** (US1), with stubs, then on the test copy: a release without logs,
   a newer store refused, a failing service check, an older store, a shrink, an interruption.
5. **`cutover` and `rollback-cutover`** (FR-002a, FR-009) on the test copy, success, failure and interruption;
   then on the host, run with sudo by its holder.
6. **`retire`** (FR-011), on the host, once the container has served a while.
7. **Documentation**: README (the stack's start, the steps, never `docker image prune -a` on the graph's images),
   RELEASE-TESTING.md and spec 011's release-day order (the release step before the cache purge and warm-up; a
   second Tomcat restart if the analysis file arrives later), the major-version migration as separate work (FR-008),
   docker-compose.yml's comments, and the claims about java-library in specs/015 and its source (R5).

## Complexity Tracking

| Choice                                             | Why needed                                                                                                                                | Simpler alternative rejected because                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A locally built image as the applied configuration | A merged change must not apply until a step runs it (FR-010); a newer minor changes the system database irreversibly on first start (R2). | An env file outside the repo: any compose call without it falls back to the repository's values, which is what FR-010 forbids. |
| A separate one-start run of the same image         | The two allowances must never reach a restart or a reboot (FR-010a).                                                                      | Passing them to the compose service: its restart policy would bring them back.                                                 |
