# Research: The graph database in a container, its version a setting

Measured on 27 Oct 2026. The Neo4j measurements ran on a private copy of release 98's store (the host's
`data/databases/graph.db`, 2.5 GB, written by Neo4j 4.3.6 Community), copied as a release arrives (the store
folder alone, no transaction logs) into a scratch data folder, and served by the vendor's images on a spare
loopback port with a test password. Nothing queried the graph the services use; the copy was removed after.
The repository facts were read from `main` at `8fbfdc3e`. [M] marks a measurement, [R] a reading of the code
or the vendor's documentation, [I] an inference not yet measured.

## R1. The vendor's image over a copied store

- **Without the missing-logs allowance** [M]: Neo4j 4.3.6 logs `Started.`, but `graph.db` is **offline**
  (`Transaction logs are missing and recovery is not possible`); only `system` is online. A step that waits for
  "Started" alone would report success on a graph that answers nothing.
- **With it, for one start** (`NEO4J_dbms_recovery_fail__on__missing__files=false`) [M]: the start writes
  `transactions/graph.db` (a checkpoint and a log). The next start, **without** the allowance, has `graph.db`
  online and answering release 98. Twice, `graph.db` was not seen online during the allowance run itself
  (polled for 60 s) though its logs were written; why is not yet known, so the design does not depend on it:
  the allowance run repairs, is stopped, and the checks are made on the standing start that follows. To be
  measured again in the first task.
- **Interrupted** [M]: killed before its recovery (4 s in), the allowance run left no logs; the standing start
  then kept `graph.db` offline (nothing damaged, and visible to a check), and running the allowance start again
  repaired it. Killed after `Started.`, the logs were already there and the standing start was online.
- **Owner** [M]: run as root (the image's default), the entrypoint changes the owner of every file in the
  bind-mounted folder to 7474. Run with `--user` set to the folder's owner, nothing changes owner (0 files) and
  the store opens. So the container runs as the data folder's owner (on the host, the package's `neo4j` user):
  the owner never changes, and going back to the host installation needs no repair.
- **Password** [M]: once `data/databases/system` exists, `NEO4J_AUTH` is ignored: restarted with another
  password, the first one still logs in and the new one is refused. On the host the system database already
  exists, so the container keeps the host installation's user and password; the step checks that the
  credentials file's pair logs in (FR-005), and the documentation says how to set it (`ALTER CURRENT USER SET
PASSWORD` with the old one) when it does not.
- **The release number** [M]: `MATCH (d:DBInfo) RETURN d.releaseNumber` (98); `d.version` does not exist.
- **Readiness** [M]: `SHOW DATABASE graph.db YIELD currentStatus` must be `online` before the release query.

**Decision:** a release's store is brought up by a separate run of the applied image with the allowance, never
restarted (`docker run --rm --restart no`), stopped once its transaction logs exist; then the standing service
starts and is checked by database status and release number. The container runs as the data folder's owner.

## R2. 4.3.6 to 4.4 within the major version

- **The store** [M]: 4.4.48 opens the 4.3.6 store with no `dbms.allow_upgrade`. Both databases keep record
  format `PageAlignedV4_3[AF4.3.0]`, `dbms.upgradeStatus()` says `CURRENT`, and `graph.db`'s `neostore` has the
  same sha1 before and after.
- **The system database** [M]: that 4.4.48 start upgraded the system graph's `dbms-runtime` component on its
  own (single-instance automatic upgrade). Afterwards **4.3.6 refuses to start at all**: `Unsupported component
state for 'dbms-runtime': The sub-graph is unsupported because it is a newer version`. So a newer minor version
  makes an irreversible change on its first start even when no store upgrade is allowed.
- **Consequences:** (1) a merged version setting must never be started by accident (FR-010's applied
  configuration is necessary, not tidy); (2) the copy before an apply is the only way back; the system database
  is what changes, but the copy is the whole data folder (3.2 GB on the host) because a format change in a later
  minor would touch the store too [R]; (3) `dbms.allow_upgrade=true` is still passed, for one start only, when
  the version changes (the vendor's guide asks for it where a format changes) [R].
- **APOC per version** [R/M]: APOC is built per Neo4j minor version. Host: `apoc-4.3.0.12-all.jar`, sha256
  `a59fc3376e2c78716203fc72f00cdaa95c2e3f55fd13a5a774eb00097d4d2d1b` [M]. reactome/reactome_neo4j_env pins
  4.4.0.40, sha256 `3ecb3bda4d4b1659a4dd0e02d75d7c3df44bbcee1354c4cb01527a6f807733ab`, from the
  neo4j-contrib release page [R]. A version change therefore changes a plugin pin in the same pull request.
- **Image digests** [M]: `neo4j:4.3.6-community` sha256:cda7786843922909655ef8c7b8771d192ea3fa3557eecfe24add193d4c916e48;
  `neo4j:4.4.48-community` sha256:8eafc3086b74b015be0cf911ea7d1917aba932394bf91f0bcb44397d36f82e2f.

**Decision:** the version setting names the image by tag and digest; an apply that changes the version copies
the data folder, starts once with `allow_upgrade`, then standing, and checks `dbms.components()` and
`dbms.upgradeStatus()`; rollback is the copy and the previous image.

## R3. The applied configuration and how compose reads it

- **Compose today** [R]: `graphdb` (docker-compose.yml:178-233) is the project's own image with the store in a
  named volume, `restart: unless-stopped`, Bolt on 127.0.0.1:7687 only, a bash wrapper as entrypoint that turns
  authentication on from the credentials file. Nothing has `depends_on: graphdb`; content-node and java-library
  reach 127.0.0.1:7687 by host networking, Tomcat from the host.
- **Profiles** (Compose 2.40.3, probed with throwaway containers) [M]: a plain `docker compose up -d`,
  `restart`, `up --remove-orphans` or `down` leaves a running profiled container alone; naming it starts it. A
  non-profiled service that `depends_on` a profiled one makes the project invalid for every command.
- **Where the applied configuration lives** [I, chosen]: a local image tag. The apply step builds
  `reactome-graphdb:applied` from `deploy/graphdb/graph.json` (base image by digest, plugins checked by sha256,
  settings as a configuration file, the data folder's owner as `USER`) and keeps the one it replaces as
  `reactome-graphdb:previous`. The compose service names only `reactome-graphdb:applied` with `pull_policy:
never`, in a profile, with no settings of its own. A merged change to `graph.json` reaches nothing until a step
  builds it; any start, restart or reboot runs what the last step applied. Beside it, a host state folder
  (default `/var/lib/reactome-graphdb`, a setting of the steps) holds `applied.json` (what was applied, and from
  which commit), `state.json` (the step under way, FR-010a), the counts of the serving database, and the
  set-aside database and data copies.
- **Alternatives:** an env file outside the repository (every compose call must pass it; a bare call would fall
  back to a repo default, the very thing FR-010 forbids); a separate compose project for the graph (no profile
  needed, but "the whole stack" becomes two projects and two sets of documentation).
- **Interrupted steps** [I, chosen]: the wrapper, baked into the applied image (so a merged change to it waits
  for an apply too), reads `state.json` (mounted read-only) and refuses to start while a step is recorded under
  way, naming it, unless the start is that step's own (the step passes the id it recorded); `status` says how to
  finish or undo it. Every step stops the standing container before it records anything, and a container stopped
  by `docker stop` is not brought back at boot by `unless-stopped`; if one is started anyway while a step is
  recorded, it is refused and retried with backoff until the step finishes, which is intended.
- **One step at a time** [I, chosen]: every subcommand but `status` holds an exclusive `flock` on the state folder
  for its whole run, so two steps (from two sessions, say) cannot interleave between reading and writing
  `state.json`.

## R4. The counts check

[M] On the copy: events 119,718, physical entities 412,186, species 97, in one query of three label counts,
2.3 s including cypher-shell's start (4.5 s cold). Label counts come from the count store, so the cost does
not grow with the graph. `cypher-shell` runs inside the container (the host's copy goes with the package).

## R5. The services' release checks and restarts

| Service                                            | Release answer                                        | Restart                               |
| -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| content-node                                       | `127.0.0.1:4400/ContentService/data/database/version` | `docker compose restart content-node` |
| Java ContentService                                | `127.0.0.1:8080/ContentService/data/database/version` | `systemctl restart tomcat9`           |
| Java AnalysisService (reported, from its own file) | `127.0.0.1:8080/AnalysisService/database/version`     | the same Tomcat                       |
| java-library                                       | `127.0.0.1:4360/health`, field `release`              | `docker compose restart java-library` |

[M] On 27 Oct java-library answered **97** while the graph answered 98, until it was restarted: it holds the release in memory, despite its documentation (specs/015 tasks.md, `SbmlFiles.java`)
saying it reads it per request. It is therefore restarted and checked like the others. content-node holds it
for the life of the process (`answers.ts` `cached()`).

## R6. The steps' language and tests

- [R] The operational scripts run as root are bash (`deploy/apache/*.sh` with an `id -u` guard,
  `deploy/graphdb/entrypoint.sh`, `deploy/nginx/test-config.sh`); TypeScript under `tools/` is for services and
  tools that Node 24 runs. A non-interactive root shell on the host gets Node 18, which cannot run `.ts`.
- [R] Shell is tested by vitest spawning bash with stub commands on `PATH` (`entrypoint.spec.ts`).

**Decision:** one bash script, `deploy/graphdb/graph.sh`, with subcommands, using `docker`, `jq`, `curl`,
`systemctl`; tested by `deploy/graphdb/graph.spec.ts`-style vitest specs with stub `docker`, `systemctl` and
`curl` for every path (success, each failure, interruption), and by the test-copy runs of SC-005 against the real
images. The version rules (FR-012) live in a TypeScript spec that reads `graph.json`; the steps repeat only the
checks they need at run time (same major, not older than the store), with a test that the two agree.

## R7. The CI check and what it replaces

- [R] `deploy/**/*.spec.ts` run in `npm test`, so in CI's unit job and in preflight.
- **`deploy/graphdb/graph.json`** holds: the Neo4j version, image and digest; the recorded release-build version;
  the plugins (name, version, url, sha256); the settings. **`graph.spec.ts`** fails on: a version older than the
  release-build version or in another major; a required setting missing (default database, Bolt address, memory,
  procedures); `dbms.allow_upgrade` or `dbms.recovery.fail_on_missing_files` in the settings; a plugin without
  version, url or sha256; a plugin whose version is not for the image's minor version.
- **`compose.spec.ts` is rewritten:** loopback-only ports (its parser kept); the profile; `image:
reactome-graphdb:applied` with `pull_policy: never`; no `environment:` settings; a bind mount of the data folder,
  not a volume; no service with `depends_on: graphdb`. The tag/volume pairing goes with the volume.
- **A test copy's own names:** the image name and the Bolt port are compose variables defaulting to
  `reactome-graphdb` and 7687, and the compose project is chosen by the steps (default: the stack's, named by the
  repository's directory); a test copy sets all three, so it never meets the serving graph's port, image or
  containers. `compose.spec.ts` checks the defaults.
- **The wrapper's refusals** stay for a first start on an empty folder (where `NEO4J_AUTH` still applies): no
  credentials, the default password, a user other than `neo4j`, `/` in the password. Over an existing system
  database they guard nothing, and are kept rather than relaxed: the steps' login check (R1) is what holds there.
- Each new check is shown failing once (constitution III).

## R8. Cut-over and retirement

- The first applied image is 4.3.6 (the store's version, FR-002a), so the cut-over upgrades nothing; it still
  takes a data copy first. Cut-over: stop the host service, copy (a copy is only ever taken with Neo4j stopped), disable it, start the container as the folder's
  owner, check. Rollback while the package is installed: stop the container, enable and start the host service,
  check; the owner never changed (R1).
- Retirement: the service is disabled and the package
  removed with `apt-get remove` (not `purge`, which would offer to delete `/var/lib/neo4j`), keeping the data
  folder. After retirement the cut-over rollback is gone, as FR-009 says.

## R9. From the plan's review (#723)

Checked by the reviewer on empty folders with the vendor's images [M, theirs], or read from the vendor's docs [R]; the
build tool checked here [M]:

- **The image's configuration file must stay writable** [M, theirs]: run as a non-root `USER`, the vendor entrypoint
  appends its defaults to `conf/neo4j.conf` on every start and fails (`Permission denied`) if a root-owned, read-only
  file was copied in. The Dockerfile writes the settings to a file the folder's owner can write, as the vendor ships
  `conf` (mode 777).
- **No BuildKit on the host** [M]: `docker buildx` is not installed (Docker 29.1.3), so the image is built with the
  legacy builder: no `ADD --checksum`, `COPY --chmod` or heredocs. The plugins are fetched on the host with `curl`,
  checked with `sha256sum`, and copied into the build context.
- **A misspelt setting is ignored** [M, theirs]: `dbms.config.strict_validation` is false by default. It is set to
  true in the standing settings, so a misspelt name stops the start, which a check sees.
- **Turning automatic upgrade off does not keep 4.4 reversible** [M, theirs]: with
  `dbms.allow_single_automatic_upgrade=false`, 4.4.48 left the system database `REQUIRES_UPGRADE`, and 4.3.6 still
  refused the folder (its transaction logs were written in 4.4's format). The data copy remains the only way back
  (R2). Neo4j's message there names an _older_ version wrongly, so the steps never pass its text on as the reason.
- **Detecting a store the server cannot read, before any change** [R, theirs; to measure]: `neo4j-admin store-info`
  exists in 4.3.6 and reads a stopped store's format and the version that introduced it. The release step runs it,
  from the applied image, on the delivered store (mounted read-only), and refuses before changing anything when the
  format is newer than the server's or from another major. Stores of 4.3 and 4.4 share a format (R2), so within the
  major it cannot tell them apart, and does not need to.
- **Steps run under sudo** [R]: `~` in compose's default for the credentials file resolves to root's home under
  sudo, and the user's exported overrides are lost. The steps take the credentials file and the compose project from
  their own settings file in the state folder (absolute paths), never from `~` or the caller's environment. The
  password for a check is read with the wrapper's literal parser and handed to `cypher-shell` in the container's
  environment (`docker exec -e NEO4J_PASSWORD`), never on a command line, where `ps` would show it.
- **`docker image prune -a`** [R]: removes images no container uses, so `:previous` always and `:applied` whenever its
  container is removed. The images carry a label, `status` reports a missing tag, and the documentation says not to
  prune them; `:applied` is rebuilt from `applied.json` if lost (needs the registry and the plugin downloads).

## R10. Re-measured in T001 (28 Oct 2026)

A fresh private copy of release 98's store, the pinned 4.3.6 image, run as the folder's owner on a spare loopback
port; removed afterwards.

- **Why `graph.db` stayed offline in the allowance run** (R1's open item) [M]: the copy was read from a running
  server, so its index files were mid-cleanup (`GB+Tree … generation:61/64`). On the forced-recovery path Neo4j
  4.3.6 writes the logs (about 10 s in), logs `Started.` (about 11 s), then fails the database in its index service:
  `Index clean jobs can't be added after collector start`. A graceful stop took 6 s; the standing start that followed
  was online in 12 s, at release 98, all 36 indexes `ONLINE`, the counts unchanged (119,718 events, 412,186 physical
  entities, 97 species).
- **A store from a clean shutdown** [M]: the same copy, stopped gracefully and its logs removed, came online in the
  allowance run itself (11 s, release 98). So a delivered store may or may not come online during that run, depending
  on how it was copied.
- **The allowance run's stop condition** (decided): `Started.` in its log and files under `transactions/graph.db`;
  then a graceful stop (`docker stop -t 120`), the run's log kept, and the standing start checked (online, release,
  every index `ONLINE`, counts). The run's own database status is never the test. Files under
  `transactions/graph.db` appear a moment before the recovery checkpoint is written (`checkpoint.0` is a 64-byte
  header until `Checkpoint triggered by "Recovery completed."`, #729's review); waiting for `Started.` covers that,
  since it is logged after the database's start has finished or failed. `Started.` with no logs written is a
  failure, refused at once rather than waited on.
- **`neo4j-admin store-info`** [M]:
  - on a sound store it prints `Store format version: AF4.3.0`, `Store format introduced in: 4.3.0` and `Store needs
recovery: true` (no logs), and exits 0;
  - on a store whose `neostore` records are overwritten it exits 1 (`Uninitialized version field in …/neostore`); on
    a folder with no store, exit 1 too;
  - it cannot run on a read-only mount: it takes the store's lock file (`Could not write to: …/database_lock`);
  - it creates an empty `transactions/graph.db` beside the store's `databases/` folder.
    So the release step runs it with the image's entrypoint bypassed, as the folder's owner, in a scratch data root
    with the delivered store bind-mounted at `databases/graph.db`: the lock file it writes is in the store (empty, and
    replaced at start), and the empty folder it makes is in scratch (the mount points Docker creates there are owned by
    root, so the step removes the scratch root as root). A non-zero exit, or an "introduced in" version newer than
    the server or of another major, is refused with the step's own reason. Every other file of the store is left
    byte-identical (#729's review hashed them).
- **The host installation's settings** [M], for `graph.json` (T002): Bolt thread pool 20 to 100, keep-alive 10 min;
  default database `graph.db`; listen on loopback (in the container: all interfaces, published on loopback only);
  heap 3 GB initial and maximum; page cache 2 GB; `dbms.security.procedures.unrestricted=algo.*,apoc.*`; transaction
  logs kept one day; transaction state on heap. Directory and JVM settings are the package's own defaults, which the
  image has its own of. Two are allowances, not settings: `dbms.recovery.fail_on_missing_files=false` (R1) and
  `unsupported.dbms.tx_log.fail_on_corrupted_log_files=false`, which starts a database over corrupted logs. The first is
  for one start of a step; the second no step uses. Both are refused in the standing configuration (T002).

## Open, carried into the tasks

- Restoring a set-aside store older than an upgraded server: the release rollback opens it as the release step
  opens an older store (allowance for one start); shown on the test copy.
- Tomcat's restart time on the host (SC-001's 10 minutes), measured at the first host release (T015).
- Leftover copies of transaction logs beside the data folder's own: removed once the container serves.
