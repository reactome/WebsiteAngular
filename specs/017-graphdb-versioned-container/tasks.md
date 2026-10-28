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

- [x] T001 Re-measure, on a private copy of the serving release's store, what research R1 and R9 left open, and record
      it in `specs/017-graphdb-versioned-container/research.md` (its Open items):
  - the `graph.db` status during the missing-logs allowance run, polled throughout, and when its checkpoint is
    written; from these, the concrete stop condition for an allowance run (for example: `Started.` logged, files
    under `transactions/graph.db`, and the checkpoint line in `debug.log`), then a graceful stop;
  - `neo4j-admin store-info` from the 4.3.6 image on the copy (stopped, mounted read-only), and what it prints for a
    store it cannot read (a corrupted `neostore` header stands in for a newer format);
  - how long the allowance run and a standing start take on this host's disk.
    Also read the host installation's `dbms.*` settings (names and values only, no credentials) for T002, and correct
    plan.md's header branch. — #729. Research R10: the allowance run's database fails in its index
    service when the store was copied from a running server, and comes online itself after a clean shutdown; the stop
    condition is `Started.` and logs written, then a graceful stop and a checked standing start. `store-info` needs a
    writable mount and a scratch data root. The host's settings listed for T002, two of them allowances.

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
- [ ] T005 Rewrite the `graphdb` service in `docker-compose.yml`: profile `graph`; the image
      `${GRAPHDB_IMAGE:-reactome-graphdb}:applied` with `pull_policy: never` (a test copy names its own image, so it
      never retags the serving graph's); no `environment:` settings; the data folder as a bind mount (from a variable with no
      repository default, documented), the state folder read-only, the credentials file; Bolt on 127.0.0.1 only, its port
      `${GRAPHDB_BOLT_PORT:-7687}` (a test copy sets another, B2);
      `restart: unless-stopped`; `stop_grace_period: 120s`; no `depends_on: graphdb` anywhere; the release volumes and
      their definitions removed. Rewrite `deploy/graphdb/compose.spec.ts` for exactly these (the
      defaults included: 7687 and `reactome-graphdb`), keeping its port parser and
      its test; each rule seen failing. Show with throwaway containers that a plain `docker compose up -d`, `restart` and
      `down` leave a running `graphdb` alone. Nothing on the host changes: the host Neo4j keeps serving.
- [ ] T006 Write the skeleton of `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts` (stub `docker`,
      `systemctl`, `curl`, `apt-get`, `dpkg`, `flock`-safe), per [contracts/graph-sh.md](contracts/graph-sh.md):
  - settings from `steps.env` in the state folder, `--state <folder>` to point at a test copy (its port, image
    name and compose project included, passed to compose as `GRAPHDB_BOLT_PORT`, `GRAPHDB_IMAGE` and the project
    name, so a test never meets 7687 or the serving graph's image), never from `~` or the caller's environment;
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

## Phase 3: User Story 4, part one - the cut-over (P2, first because every test copy starts from it)

**Goal**: a test copy (and later the host) goes from a host installation to the container, with the way back.
**Independent test**: on a test copy with a stand-in host service, the cut-over and its rollback.

- [ ] T007 [US4] Implement `cutover` and `rollback-cutover` in `deploy/graphdb/graph.sh` and
      `deploy/graphdb/graph-sh.spec.ts` (FR-002a, FR-009). `cutover` is the first apply: it implements the image build that
      `apply` (T011) reuses (each plugin fetched with `curl` into the build context and checked by sha256, then the
      legacy build of T003) and builds the first `:applied` (the image must be the store's version), writes the first `applied.json` and `history.json`, checks
      the login against the host installation, stops the host service, copies, disables it, starts the container as
      the folder's owner, checks, restarts and checks the services; on failure, `rollback-cutover`. It is also how a
      test copy is first brought up, so every later task's test-copy runs start from it. The stand-in host service
      is the vendor's 4.3.6 image serving the copy on its test port, started and stopped by a stubbed `systemctl`, so
      the login and the checks are real. **Decide (C1, first half)** the cut-over rollback's window: until `retire` (the spec), or only while the
      cut-over is the last step (the contract's order rule), and amend the spec or the contract to match; the decision's test lands with T009
      (a `rollback-cutover` after a release), once a later step exists. Test-copy runs 1, 13 and 14, a `rollback-cutover` that fails and one
      interrupted.

## Phase 4: User Story 3 - What runs is what the repository says (P2)

**Goal**: the configuration is read in the repository, and the host shows whether it runs it.
**Independent test**: a `graph.json` change not applied is reported as pending, naming the step.

- [ ] T008 [US3] Implement `status` in `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts`: applied
      (from `applied.json`) against `graph.json` in this checkout, with the commit read; a step under way and its
      rollback; the last completed step; `graph.db`'s status and release; each service's release (content-node,
      Tomcat ContentService, java-library; AnalysisService reported); one Neo4j on the port; the copy's `:applied` and
      `:previous` images present. Read-only, no lock. Every other subcommand prints the pending line first. Shown on
      a test copy after T007's cut-over (a pending change, a step under way); straight after the cut-over there is no `:previous` (nothing applied since), which `status` reports as
      normal, unlike a `:previous` missing after an apply (run 20); `:previous` and run 20 come with T012,
      run 11's status half with T012.

## Phase 5: User Story 1 - A new release's graph comes up (P1)

**Goal**: one step brings a delivered store into service, every service checked, with the way back.
**Independent test**: on a test copy, a release without logs brought up, and a refused one leaving the old serving.

- [ ] T009 [US1] Implement `release <folder> [--shrink-expected] [--no-baseline]` in `deploy/graphdb/graph.sh` and
      `deploy/graphdb/graph-sh.spec.ts`:
  - refusals before any change: `neo4j-admin store-info` on the delivered store (newer format or another major,
    with a reason of the step's own, also when `store-info` cannot read it at all, never Neo4j's message); the serving
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
    Test-copy runs 2, 3, 6, a store delivered with its logs, a login mismatch, a room refusal (stubs), a `rollback-cutover` after this
    release (T007's C1 decision, either refused or allowed as decided), and run
    17 (two steps at once, refused by the lock). Time the whole step on the copy against SC-001's 10 minutes.
- [ ] T010 [US1] Implement `rollback-release` in `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts`:
      the set-aside database back (an older store, after an upgrade, opened as `release` opens one); the services
      restarted and checked; if that fails too, stop and report, the restored database serving, no loop. **Decide (C1,
      second half)** whether it stays allowed after a later apply (the spec keeps the set-aside database "so a problem
      found later still has one way back"; the order rule says no), and amend the spec or the contract; the decision's test lands with T012 (a release
      rollback after an apply). Test-copy runs 4 (a release whose service check fails, rolled back), 7, 15, and an interrupted `rollback-release`.

## Phase 6: User Story 2 - The Neo4j version is upgraded deliberately (P1)

**Goal**: a reviewed change to `graph.json`, applied by one step, with the way back.
**Independent test**: on a test copy, 4.3.6 → 4.4.48 and back.

- [ ] T011 [US2] Implement `apply` in `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts`: build the
      copy's `:applied` image with T007's build (plugins fetched and checked by sha256; its name a setting, so a test
      copy never retags the serving graph's), the data folder's owner as `USER`; refuse another
      major (FR-008); room; login; stop gracefully; **decide** whether the previous data copy is removed before the
      new one (room) or only after this step succeeds, and what a failure then leaves; take the copy (`cp -a`,
      stopped); retag the old image `:previous`; if the version changed, one allowance run with
      `dbms.allow_upgrade=true` (stop condition from T001); standing start; checks (`dbms.components()`,
      `dbms.upgradeStatus()`, release, login); restart and check the services; `applied.json` last. A plugin-only or
      setting-only change applies the same way. Decide whether `:applied` can be rebuilt from `applied.json` (a
      subcommand) or the claim is dropped from research R9. Test-copy runs 8 and 12, and run 5: a release (T009) of
      a 4.3.6 store onto the copy now serving 4.4.48, opened with store upgrade for one start (US1 AS 4).
- [ ] T012 [US2] Implement `rollback-apply` in `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts`:
      allowed when the last step (completed or interrupted) is an apply; stop; restore the copy and `:previous` as
      `:applied`; start; checks; services. Test-copy runs 9, 10, 16, 19 (a misspelt setting applied, then
      rolled back), a `rollback-apply` that fails, run 18 (refused
      after a later release), a `rollback-release` after an apply (T010's C1 decision, either refused or allowed as
      decided), run 20 (`:previous` removed, reported by `status`), and run 11 with a real `docker`
      daemon restart (US4 AS 2). Measure SC-002: a failed upgrade back to serving in under 10 minutes.

## Phase 7: User Story 4, part two - retirement and the host

**Goal**: the host serves from the container; nothing starts a second Neo4j; the package goes.
**Independent test**: a real `docker` daemon restart part way through a step on a test copy; then the host runs.

- [ ] T013 [US4] Implement `retire` in `deploy/graphdb/graph.sh` and `deploy/graphdb/graph-sh.spec.ts`: with the
      container serving and checked and no step under way, disable the host service and `apt-get remove` the package
      (not `purge`), keeping the data folder. Test with a stand-in package (stubbed `apt-get` and `dpkg`). On a test
      copy, a real `docker` daemon restart part way through a `release` (US4 AS 3): the graph does not start on the
      half-changed folder, and `status` names the step.
- [ ] T014 [US4] On the host, from `deploy/graphdb/graph.sh`: write `steps.env` (absolute paths), run `status`, then
      `cutover`, then `status`, each with sudo by the person who holds it, after a stand-in run of the same commands;
      every service answers the release; one Neo4j on the port. Record the outcome here (no host detail).
- [ ] T015 [US4] On the host, at the next release, from `deploy/graphdb/graph.sh`: `release <folder>` with sudo by
      its holder; time it against SC-001; load a page that shows the release and see the new one with no further
      restart (US1 AS 6); then spec 011's cache purge and warm-up. Record the outcome here.
- [ ] T016 [US4] On the host, once the container has served through a release: `retire` from
      `deploy/graphdb/graph.sh`, with sudo by its holder; `status` after.

## Phase 8: Polish

Each of these ticks this file in its own pull request, so they conflict at the same lines: merge one at a time and
rebase the next.

- [ ] T017 [P] Document the graph in `README.md` (the stack's start, the steps, `steps.env`, never `docker image
prune -a` on the graph's images, how to set the database's password from the credentials file) and a short
      section in `CLAUDE.md`; replace `docker-compose.yml`'s comments on the graph (the release procedure, the
      analysis service named as a reader, content-node's note about the graph becoming a container).
- [ ] T018 [P] Put the release step into the release-day order: `RELEASE-TESTING.md` and
      `specs/011-api-cache-headers/quickstart.md` (the release step before the cache purge and warm-up; a second
      Tomcat restart if the analysis file arrives after it).
- [ ] T019 [P] Document a change of major version (FR-008) as separate work in `deploy/graphdb/MAJOR-VERSION.md`: a
      store migration, the plugin's new version, the services checked against it, and why `apply` refuses it.
- [ ] T020 [P] Correct the claims that java-library reads the release on every request:
      `specs/015-graph-exports/tasks.md` and
      `deploy/java-library/src/main/java/org/reactome/server/library/SbmlFiles.java`; note in
      `specs/006-content-service-to-node/research.md` (D13) and specs/015's reference harness that this spec
      supersedes them.
- [ ] T021 On the host after the cut-over, with its holder, from `deploy/graphdb/graph.sh status`: remove the
      leftover transaction-log copies beside the data folder, the old graph container and its volumes, the old local
      images, and the override file and script outside the repository that ran the old arrangement; `status` after.

## Dependencies

- T001 → T002 → T003 → T004, T005 (in either order) → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 →
  T014 → T015 → T016.
- T017–T020 follow T013 (T017 documents `retire`); T021 follows T014.
- The cut-over comes first among the steps because it is how a test copy gets its first applied state; the release
  comes before the upgrade because it is needed every release and needs only the cut-over's image and checks;
  its run with an older store (run 5) waits for the upgrade, which is what makes the serving version newer than
  the store.

## Parallel opportunities

- T004 and T005 touch different files once T003 has merged.
- T017, T018, T019 and T020 touch different files (but each ticks this one: merge them in turn).

## Implementation strategy

The MVP is Phases 1–5 on a test copy: a copy cut over, a release brought up and rolled back by one step. Phase 6 adds
the version change; Phase 7 moves the host onto it. Until T014 the host Neo4j keeps serving as it does now.
