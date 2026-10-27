---
description: 'Tasks for spec 017: the graph database in a container, its version a setting'
---

# Tasks: The graph database in a container, its version a setting

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Every task**:

- Is one pull request, with its own adversarial review, and ticks this file with its PR number in that same pull
  request.
- Shows each new check failing before it is trusted (constitution III), and says how in the pull request.
- Tests the steps with stub commands (the `entrypoint.spec.ts` pattern) and, where Neo4j's behaviour matters, on a
  **private test copy**: a store copied into a scratch data folder by reading files, a spare loopback port, a test
  password and its own state folder (`--state`), removed afterwards. Never the serving graph, never port 7687.
- Leaves the host untouched unless the task says otherwise. A host step is run with sudo by the person who holds it,
  from a script that has had a stand-in run (stubbed commands) first.
- Keeps the repository public: no host names, credentials or internal release process.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Re-measure, on a private copy of the serving release's store, what research R1 and R9 left open, and record
      it in `specs/017-graphdb-versioned-container/research.md` (its Open items):
  - the `graph.db` status during the missing-logs allowance run, polled throughout, and when its checkpoint is
    written; from these, the concrete stop condition for an allowance run (for example: `Started.` logged, files
    under `transactions/graph.db`, and the checkpoint line in `debug.log`), then a graceful stop;
  - `neo4j-admin store-info` from the 4.3.6 image on the copy (stopped, mounted read-only), and what it prints for a
    store it cannot read (a corrupted `neostore` header stands in for a newer format);
  - how long the allowance run and a standing start take on this host's disk.
    Also read the host installation's `dbms.*` settings (names and values only, no credentials) for T002, and correct
    plan.md's header branch.
- [ ] T002 Create `deploy/graphdb/graph.json` at Neo4j 4.3.6 (tag and digest, research R2), `releaseBuild` 4.3.6, APOC
      4.3.0.12 (url and sha256, R2), and the settings from T001 that matter, each with its reason in the pull request,
      plus `dbms.config.strict_validation=true` (R9). Add `deploy/graphdb/graph.spec.ts` for every refusal in
      [contracts/graph-json.md](contracts/graph-json.md), each shown failing on a one-line change of the real file. Add
      `strict_validation` to research R7's list.

## Phase 2: Foundational

- [ ] T003 Write `deploy/graphdb/Dockerfile` for the applied image, built with the legacy builder (no BuildKit-only
      syntax: no `ADD --checksum`, `COPY --chmod`, heredocs): `FROM` the base by digest; the plugins copied from the
      build context (the step fetches them with `curl` and checks their sha256 first); the settings written to a
      configuration file the image's user can write (the vendor entrypoint appends to it at every start, R9); the wrapper
      `deploy/graphdb/entrypoint.sh` copied in as the entrypoint; `USER` from a build argument (the data folder's owner);
      a label naming it this graph's. Show on the private copy: built, started as the owner, `graph.db` online, no file
      changes owner; and a read-only configuration file failing the start.
- [ ] T004 Extend `deploy/graphdb/entrypoint.sh` and `deploy/graphdb/entrypoint.spec.ts`: refuse to start while
      `state.json` in the state folder (mounted read-only as a folder, never the file, so a missing file is not turned
      into a directory) records a step under way, naming it. **Decide (A1)** how a step's own starts pass, both the
      allowance run and the standing start that follows while the step is still recorded, without the pass surviving a
      reboot through `restart: unless-stopped` (for example: the step's own runs are `docker run --rm --restart no` with a
      one-run token the wrapper matches against `state.json`, and the standing start comes only after the step records a
      phase the wrapper accepts); record the decision in research R3. Keep the first-start refusals (no credentials, the
      default password, a user other than `neo4j`, `/` in the password). Each refusal and each pass seen failing.
- [ ] T005 Rewrite the `graphdb` service in `docker-compose.yml`: profile `graph`; `image: reactome-graphdb:applied`
      with `pull_policy: never`; no `environment:` settings; the data folder as a bind mount (from a variable with no
      repository default, documented), the state folder read-only, the credentials file; Bolt on 127.0.0.1:7687 only;
      `restart: unless-stopped`; `stop_grace_period: 120s`; no `depends_on: graphdb` anywhere; the release volumes and
      their definitions removed. Rewrite `deploy/graphdb/compose.spec.ts` for exactly these, keeping its port parser and
      its test; each rule seen failing. Show with throwaway containers that a plain `docker compose up -d`, `restart` and
      `down` leave a running `graphdb` alone. Nothing on the host changes: the host Neo4j keeps serving.
- [ ] T006 Write the skeleton of `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts` (stub `docker`,
      `systemctl`, `curl`, `apt-get`, `dpkg`, `flock`-safe), per [contracts/graph-sh.md](contracts/graph-sh.md):
  - settings from `steps.env` in the state folder, `--state <folder>` to point at a test copy (its port and compose
    project included, so a test never meets 7687), never from `~` or the caller's environment;
  - root check; an exclusive `flock` for every subcommand but `status` (a second step refused at once);
  - `state.json` written before each change, with the phases of [data-model.md](data-model.md) plus those #724's
    review found missing (B1): the image retag, `applied.json` (written only after the checks pass), the host
    service disabled, the package removed;
  - `history.json`: completed steps; what "last" means after a rollback (a rollback is itself recorded, and undoes
    only the step before it; no chains) and for an interrupted step (its rollback is allowed) (B3);
  - a log per run under `logs/`, its path printed last;
  - the password read with the wrapper's literal parser and passed as `docker exec -e NEO4J_PASSWORD` (the name
    only, the value in the script's environment), never `-e NAME=value` or `-p`; a test that `ps`-visible arguments
    never hold it;
  - the room check (what the step writes, plus images, plus 2 GB) and the login check;
  - a check that the version rules the steps apply at run time agree with `graph.spec.ts` (B5);
  - FR-013's reading recorded in contracts/graph-sh.md: the system-database queries are Neo4j's own state, not load
    on the graph.
    Every path seen failing with stubs.

**Checkpoint**: the image builds and starts on a private copy; compose cannot start a second Neo4j; the steps have
their frame. The host is unchanged.

## Phase 3: User Story 3 - What runs is what the repository says (P2, first because every step needs it)

**Goal**: the configuration is read in the repository, and the host shows whether it runs it.
**Independent test**: a `graph.json` change not applied is reported as pending, naming the step.

- [ ] T007 [US3] Implement `status` in `deploy/graphdb/graph.sh`: applied (from `applied.json`) against
      `graph.json` in this checkout, with the commit read; a step under way and its rollback; the last completed step;
      `graph.db`'s status and release; each service's release (content-node, Tomcat ContentService, java-library;
      AnalysisService reported); one Neo4j on the port; the `:applied` and `:previous` images present. Read-only, no
      lock. Every other subcommand prints the pending line first. Quickstart run 20 and the status half of run 11.

## Phase 4: User Story 2 - The Neo4j version is upgraded deliberately (P1)

**Goal**: a reviewed change to `graph.json`, applied by one step, with the way back.
**Independent test**: on a test copy, 4.3.6 → 4.4.48 and back.

- [ ] T008 [US2] Implement `apply` in `deploy/graphdb/graph.sh`: fetch each plugin with `curl` into the build context
      and check its sha256; build `:applied` (T003) with the data folder's owner as `USER`; refuse another major (FR-008);
      room; login; stop gracefully; **decide** whether the previous data copy is removed before the new one (room) or
      only after this step succeeds, and what a failure then leaves; take the copy (`cp -a`, stopped); retag the old image
      `:previous`; if the version changed, one allowance run with `dbms.allow_upgrade=true` (stop condition from T001);
      standing start; checks (`dbms.components()`, `dbms.upgradeStatus()`, release, login); restart and check the services;
      `applied.json` last. A plugin-only or setting-only change applies the same way. Decide whether `:applied` can be
      rebuilt from `applied.json` (a subcommand) or the claim is dropped from research R9. Test-copy runs 8, 11 (with a
      real `docker` daemon restart for US4 AS 2), 12 and 19.
- [ ] T009 [US2] Implement `rollback-apply`: allowed when the last step (completed or interrupted) is an apply; stop;
      restore the copy and `:previous` as `:applied`; start; checks; services. Test-copy runs 9, 10 and 16, a
      `rollback-apply` that fails, and run 18 (refused after a later release). Measure SC-002: a failed upgrade back to
      serving in under 10 minutes.

**Checkpoint**: an upgrade and its rollback are shown on a test copy, in success, failure and interruption.

## Phase 5: User Story 1 - A new release's graph comes up (P1)

**Goal**: one step brings a delivered store into service, every service checked, with the way back.
**Independent test**: on a test copy, a release without logs brought up, and a refused one leaving the old serving.

- [ ] T010 [US1] Implement `release <folder> [--shrink-expected] [--no-baseline]`:
  - refusals before any change: `neo4j-admin store-info` on the delivered store (newer format or another major, with
    a reason of the step's own, also when `store-info` cannot read it at all, never Neo4j's message); the serving
    database not online (no baseline) unless `--no-baseline`; the login; room;
  - the counts baseline from the serving database; a zero count fails even with `--shrink-expected` or
    `--no-baseline`; a release accepted with `--shrink-expected` becomes the next baseline;
  - stop; set aside `graph.db` and `transactions/graph.db`; move the delivered store in and give it the data folder's
    owner; a store delivered with its logs is put in place with them and needs no allowance run; otherwise one
    allowance run (with store upgrade too when the store is older within the major);
  - standing start; checks (online, release, counts ≥ 90%); restart content-node, Tomcat (the command from
    `steps.env`) and java-library, and check each; AnalysisService reported;
  - on a failure after the stop, `rollback-release`, and the delivered store moved back to its folder, with a note
    that it has had an allowance run (B4).
    Test-copy runs 2, 3, 4, 5, 6, a store delivered with its logs, a login mismatch, and a room refusal (stubs).
- [ ] T011 [US1] Implement `rollback-release`: the set-aside database back (an older store, after an upgrade, opened
      as `release` opens one); the services restarted and checked; if that fails too, stop and report, the restored
      database serving, no loop. **Decide (C1, half)** whether it stays allowed after a later apply (the spec keeps the
      set-aside database "so a problem found later still has one way back"; the copy-order rule says no), and amend the
      spec or the contract to match. Test-copy runs 7, 15, and an interrupted `rollback-release`.

**Checkpoint**: a release, its refusals and its rollback are shown on a test copy.

## Phase 6: User Story 4 - One graph at a time (P2)

**Goal**: the container replaces the host installation, and nothing starts a second Neo4j.
**Independent test**: on a test copy, the cut-over, its rollback, a daemon restart mid-step.

- [ ] T012 [US4] Implement `cutover` and `rollback-cutover` (FR-002a, FR-009): the image must be the store's version;
      build `:applied`; the login against the host installation; stop the host service; copy; disable it; start the
      container as the folder's owner; checks; services; on failure, `rollback-cutover`. **Decide (C1, other half)** the
      cut-over rollback's window: until `retire` (the spec), or only while the cut-over is the last step (the copy-order
      rule), and amend the spec or the contract. Test-copy runs 1, 13 and 14, a `rollback-cutover` that fails and one
      interrupted, and a real `docker` daemon restart part way through a step (US4 AS 3), with a stand-in host service.
- [ ] T013 [US4] Implement `retire`: with the container serving and checked and no step under way, disable the host
      service and `apt-get remove` the package (not `purge`), keeping the data folder. Test with a stand-in package
      (stubbed `apt-get` and `dpkg`).
- [ ] T014 [US4] On the host: write `steps.env` (absolute paths), run `status`, then `cutover`, then `status`, each
      with sudo by the person who holds it, after a stand-in run of the same commands; every service answers the
      release; one Neo4j on the port. Record the outcome here (no host detail).
- [ ] T015 [US4] On the host, once the container has served through a release check: `retire`, with sudo by its
      holder; `status` after.

## Phase 7: Polish

- [ ] T016 [P] Document the graph in `README.md` (the stack's start, the steps, `steps.env`, never `docker image
prune -a` on the graph's images, how to set the database's password from the credentials file) and a short
      section in `CLAUDE.md`; replace `docker-compose.yml`'s comments on the graph (the release procedure, the analysis
      service named as a reader, content-node's note about the graph becoming a container).
- [ ] T017 [P] Put the release step into the release-day order: `RELEASE-TESTING.md` and
      `specs/011-api-cache-headers/quickstart.md` (the release step before the cache purge and warm-up; a second Tomcat restart if
      the analysis file arrives after it).
- [ ] T018 [P] Document a change of major version (FR-008) as separate work in `deploy/graphdb/MAJOR-VERSION.md`:
      a store migration, the plugin's new version, the services checked against it, and why `apply` refuses it.
- [ ] T019 [P] Correct the claims that java-library reads the release on every request: `specs/015-graph-exports/tasks.md`
      and `deploy/java-library/src/main/java/org/reactome/server/library/SbmlFiles.java`; note that specs/006's research D13 and specs/015's reference
      harness (which copies the old release volume) are superseded by this spec.
- [ ] T020 On the host after the cut-over, with its holder: remove the leftover transaction-log copies beside the data
      folder, the old graph container and its volumes, the old local images, and the override file and script outside
      the repository that ran the old arrangement; `status` after.

## Dependencies

- T001 → T002 → T003 → T004, T005 (in either order) → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014
  → T015.
- T016–T019 can follow T012; T020 follows T014.
- US2 comes before US1 because the release step reuses apply's image, allowance run and service checks.

## Parallel opportunities

- T004 and T005 touch different files once T003 has merged.
- T016, T017, T018 and T019 are independent of each other.

## Implementation strategy

The MVP is Phases 1–5 on a test copy: a release can be brought up and rolled back by one step, and the version
changed by another. Phase 6 moves the host onto it; until T014 the host Neo4j keeps serving as it does now.
