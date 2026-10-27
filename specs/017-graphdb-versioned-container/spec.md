# Feature Specification: The graph database in a container, its version a setting

**Feature Branch**: `spec017/graphdb-container-4`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "The graph database (Neo4j) as a container over the host's data folder, with its version a setting, so the database version can be upgraded deliberately in future." Agreed with the project lead on 27 Oct 2026.

## Context

Every service on the host that reads Reactome's graph (the node content service, the Java
ContentService, and the java-library service's SBML and BioPAX files) connects to one Neo4j on
the loopback interface, port 7687. (The MCP service is configured without a graph address. The
Java AnalysisService answers its release from its own analysis file, loaded when Tomcat starts,
which is delivered with the release apart from the graph.) Measured on 27 Oct 2026:

- **How a release arrives.** A release's graph store is delivered by copying its database
  folder into Neo4j's data folder (`data/databases/graph.db`). Its transaction logs do not come
  with it: Neo4j 4.x keeps them apart, in `data/transactions/`. Neo4j refuses such a store
  ("transaction logs are missing") unless it is told to start without them.
- **Which version can read it.** The store is written by the Neo4j version the release is built
  with (4.3.6 Community for release 98). A server can open a store from its own version or an
  earlier one in the same major version, upgrading it, which cannot be undone; it cannot open
  a newer store.
- **What serves today.** The repository's compose service `graphdb` is the project's own 4.4
  image, with a release's store in a named volume whose name moves with the image tag, a pairing
  the repository's compose check enforces. This specification replaces that design and its check.
  It is stopped: the graph is served by Neo4j 4.3.6 installed on the host as a package, the version
  release 98 is built with. That installation's version, plugins and settings are recorded nowhere
  a reviewer can see, and changing its version is package work by hand.
- **The password lives in the data.** Over an existing data folder, Neo4j keeps its users in its
  own system database; a password given to the container is ignored once that database exists.

The project lead wants the database version to be something that can be upgraded deliberately,
not only today's release brought up.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A new release's graph comes up (Priority: P1)

An operator has a new release's graph store, delivered as a folder. They run one documented step,
naming that folder. The step sets the serving database aside, its store and its transaction logs
together (neither is overwritten), puts the new store in its place, brings the graph up on it,
checks that the graph answers the new release number and that its sizes are sane, and restarts the
services that hold the release in memory (the node content service and Tomcat), checking each
answers the new number. If any check fails, nothing is left half-switched: the operator is told
why, the database that served before is put back, and the services are restarted on it and
checked again.

**Why this priority**: it happens every release, and a required setting and two service restarts
are easy to miss by hand.

**Independent Test**: on a test copy, put one release's store in place, run the step, and see the
graph and every service answer that release; then put a store in place that the server cannot
open and see the step stop with the reason and the previous graph serving again.

**Acceptance Scenarios**:

1. **Given** a release's store without its transaction logs, **When** the operator runs the step on
   it, **Then** the graph opens it and answers the release number, and the node content service, the
   Java ContentService and the java-library service each answer the same number. The Java
   AnalysisService's number is reported beside them; it follows its own file, not the graph.
2. **Given** a store the serving version cannot open (written by a newer Neo4j, or another major
   version), **When** the operator runs the step, **Then** it stops, says the store is newer than the server, and the graph
   that served before serves again.
3. **Given** the graph comes up but a service fails its check after being restarted, **When** the step
   sees it, **Then** it puts the previous database back, restarts the services again, and checks that
   each answers the previous release.
4. **Given** a store written by an older Neo4j of the serving major version (the usual case after an
   upgrade, while releases are still built with the older one), **When** the operator runs the step,
   **Then** it opens the store with store upgrade allowed for that start only, and the checks and the way
   back are those of any release.
5. **Given** the counts check fails on a store the operator knows is smaller, **When** they run the step
   again saying the shrink is expected, **Then** the counts are reported and the step continues.
6. **Given** the step has run, **When** a page that shows the release is loaded, **Then** it shows the
   new release without any further restart.

---

### User Story 2 - The Neo4j version is upgraded deliberately (Priority: P1)

The release is to be built with a newer Neo4j (say 4.4 instead of 4.3). A maintainer changes the
version in one place in the repository, in a reviewed pull request, and an operator runs one
documented upgrade step on the host. The step first copies the data folder, then starts the new
version, which upgrades the store, and checks the graph and the services answer. If anything
fails, it puts back the copy and the old version.

**Why this priority**: the reason for this specification. Today a version change means
package-repository work on the host by hand, outside every review.

**Independent Test**: on a test copy, upgrade from 4.3.6 to a 4.4 version and see the server report
the new version with its databases current (Neo4j's own upgrade status) and the services answer; then simulate a failed start and see the copy and the old version restored
and answering as before.

**Acceptance Scenarios**:

1. **Given** the version setting changed within a major version, **When** the operator runs the upgrade
   step, **Then** a copy of the data folder is taken before anything changes, the new version starts with
   store upgrade allowed for that start only, upgrades what needs upgrading, and the graph reports the new
   version with its databases current, and the services answer; store upgrade is not left allowed afterwards.
2. **Given** the new version fails to start or to answer, **When** the step sees it, **Then** it restores the
   copy, starts the old version, and reports what failed.
3. **Given** a change of major version (for example to 5.x), **When** someone looks for how to do it,
   **Then** the documentation says it is a deliberate migration of its own (a store migration, a new
   plugin version, and checking the services against it), and the upgrade step refuses to cross a major
   version.

---

### User Story 3 - What runs is what the repository says, or is shown pending (Priority: P2)

A maintainer can read, in the repository, which Neo4j version is to run, which plugins and settings it
has, and how it gets its password; and a check in CI fails when these disagree with each other or with
the recorded version the releases are built with. On the host, an operator can see whether what runs is
what the repository says, and if not, which step applies it.

**Why this priority**: the host installation is configured by hand; the next person cannot see or review
it.

**Independent Test**: set the version older than the recorded release-build version, or in another major
version, and see CI fail; leave store upgrade or the missing-logs setting allowed in the standing
configuration, and see CI fail.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a maintainer reads the graph's definition, **Then** the version, the
   plugins (each with its version and checksum), the settings and the source of the password are all
   there.
2. **Given** a version setting older than the recorded release-build version, or in a different major
   version, **When** CI runs, **Then** it fails, saying the server could not open (or would migrate) the
   release's store.
3. **Given** the standing configuration allows store upgrade or a start without transaction logs (each is for one
   start of one step), **When** CI runs, **Then** it fails.
4. **Given** a merged change to the graph's configuration not yet applied on the host, **When** the operator
   asks for the graph's status (or runs any step), **Then** it reports the applied and the repository's
   configurations differ, and names the step that applies the change.

---

### User Story 4 - One graph at a time (Priority: P2)

Starting the stack never starts a second Neo4j competing for the graph's port, never changes the version that
serves, and the host installation is retired once the container serves.

**Why this priority**: as the repository stands, a plain start of the whole stack starts the old container
beside the host installation, both wanting port 7687.

**Independent Test**: run the documented start of the whole stack with the graph already serving, and see no
second Neo4j and no change to the one serving.

**Acceptance Scenarios**:

1. **Given** the graph serving, **When** the operator starts the whole stack as documented, **Then** exactly one
   Neo4j holds port 7687 afterwards.
2. **Given** a change to the graph's configuration (its version, a plugin or a setting) merged but not yet applied
   by a step on the host, **When** the stack (or any one service of it) is started or the host reboots, **Then** the
   graph comes back as the applied configuration, unchanged.
3. **Given** a step interrupted part way (by a reboot, on the test copy), **When** the host comes back, **Then** the
   graph does not start on a half-changed folder: the status reports the interrupted step, and running that step's
   own rollback (or the step again) brings back a checked graph.
4. **Given** the container serving the release, **When** the host installation is retired as documented, **Then**
   it no longer starts at boot and its package is removed or held off, and the data folder stays.

---

### Edge Cases

- The copied store is from a newer Neo4j than the configured version: refused, with that reason, the previous
  graph restored (User Story 1).
- The copied store is incomplete or corrupt: when the graph does not answer, the step restores the previous store
  and says so. Starting without transaction logs makes Neo4j create empty ones, so a damaged store can start and
  answer the release number. The counts check of FR-006 catches gross damage only: a known limit, not a guarantee.
- A store delivered with its transaction logs: they are put in place with it, and the start needs no missing-logs
  allowance.
- The store is older than the server, within its major version: User Story 1, scenario 4. A store from another major
  version is refused.
- The disk lacks room to set the serving store aside: the step refuses before changing anything.
- The data folder is owned by the host installation's user: the container must be able to read and write it, and
  the host installation, if still present, must not be able to start on it at the same time. Going back from the
  container to the host installation (FR-009, while it is still installed) restores the owner it had.
- The disk lacks room for the copy before an upgrade: the upgrade step refuses before changing anything.
- The password file is missing or holds no password: the graph refuses to start rather than starting without
  authentication (as the repository's graph entrypoint does today).
- The credentials file and the user the data folder's system database holds disagree: the step says so, by a
  login with the file's credentials, rather than the services failing later.
- A reboot during any step: never two graphs, and never a one-start allowance carried into a later start (the start
  that needs one is a run of its own, never restarted). The graph does not start on a half-changed folder; the status
  says which step was interrupted and how to finish or undo it (User Story 4, scenario 3).
- The restored database also fails a service's check (a service broken for another reason): the step stops there,
  leaves the restored database serving, and reports which service failed; it does not loop.
- The services keep answering the old release after the step (they cache it): the step restarts them and checks
  each, rather than trusting the graph's answer alone.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The graph MUST run from a container image whose Neo4j version is a single setting in the repository: the
  version to run. Which configuration actually runs on a host is the applied configuration (FR-010).
- **FR-002**: The graph MUST use the host's Neo4j data folder, where a release's store is put, not a container
  volume, so that the delivered store is what it opens.
- **FR-002a**: The first container version MUST be the version that wrote the serving store, and the cut-over from
  the host installation MUST take a data copy first and be covered by the rollback of FR-009, so that the first
  start upgrades nothing.
- **FR-003**: The graph's configuration MUST be in the repository: Bolt reachable from the host's loopback interface
  only; memory; the default database `graph.db`; the plugins and their procedures. Starting a store without its
  transaction logs, and store upgrade, MUST each be allowed only for the one start of the step that needs it, never in
  the standing configuration.
- **FR-004**: The plugins MUST be pinned by version and checksum, and fetched or installed only from those.
- **FR-005**: The graph MUST take its user and password from the credentials file the services already use, read
  literally, and MUST refuse to start without them. Since the data folder's system database holds the user once it
  exists, each step MUST check that the file's credentials log in, and the documentation MUST say how to set the
  database's password from the file when they do not.
- **FR-006**: A documented, scripted step MUST bring a new release's store up from the folder it is delivered in: set
  the serving database aside (its store and its transaction logs), put the new store in place, start the graph on it,
  check it answers the release number and its counts pass, restart the services that hold the release in memory,
  check each answers it, and on any failure put the set-aside database back, restart the services on it and
  check each answers the previous release. The counts (events, physical entities, species) are taken from the serving
  database before it is set aside; the check fails when any new count is zero or below 90% of the previous one,
  unless the operator says the shrink is expected. A store older than the serving version, within its major version,
  is opened with store upgrade allowed for that start only. The set-aside database is kept until the next release
  step replaces it, so a problem found later still has one way back (FR-009).
- **FR-007**: A documented, scripted step MUST upgrade the Neo4j version within a major version: copy the data folder
  first, start the new version with store upgrade allowed for that start only, check, and on failure restore the copy
  and the old version.
- **FR-008**: The upgrade step MUST refuse a change of major version, and the documentation MUST describe that
  migration as separate work.
- **FR-009**: Documented, scripted rollbacks MUST exist for: a release (to the set-aside database, with the services
  restarted and checked); an upgrade (to the previous version and its data copy); and the cut-over (to the host
  installation with the data folder's owner restored, until FR-011 retires it).
- **FR-010**: Starting the whole stack, or any service of it, or rebooting MUST NOT start a second Neo4j or change the
  one serving. The graph MUST start from the applied configuration (version, plugins and settings as a step last
  applied them), not from the repository's directly, so that a merged change waits for the step that applies it.
  A status command, and every step, MUST report when the applied and the repository's configurations differ, and
  when a step was interrupted.
- **FR-010a**: A start that needs a one-start allowance (store upgrade, or no transaction logs) MUST be a run of its
  own that is never restarted, and each step MUST record its progress before each change it cannot undo, so that an
  interrupted step is seen and the graph is not started on a half-changed folder.
- **FR-011**: The host installation MUST be retired once the container serves, by a documented step that keeps the
  data folder.
- **FR-012**: A check in CI MUST fail when the version setting is older than the recorded version releases are built
  with or in a different major version, when the required settings (FR-003) are missing, when store upgrade or a start
  without transaction logs is allowed in the standing configuration, or when a plugin is unpinned.
- **FR-013**: Beyond the graph's own start (and store upgrade, where a step allows it), the steps' only load on the graph
  MUST be the checks they name: the login, the release number, the few counts, and each service's release answer
  with the services' own startup.
- **FR-014**: Nothing in the repository may name a host, a credential, or internal release-process detail; the
  credentials file stays outside it.

### Key Entities

- **Version setting**: the Neo4j version the graph runs, in one place, with the version releases are built with
  recorded beside it.
- **Data folder**: the host folder holding the graph's databases and transaction logs; where a release's store is copied.
- **Data copy**: a copy of the data folder taken before an upgrade or the cut-over, the way back from it.
- **Set-aside database**: the store and transaction logs that served before a new release's, kept until the new one is
  checked.
- **Applied configuration**: on the host, the graph configuration (version, plugins, settings) a step last applied, and
  the progress of any step under way; what the graph starts as, and what only the steps change.
- **Graph configuration**: the settings and pinned plugins the graph starts with.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Bringing a new release's copied store into service, with every service answering the new release,
  takes one documented step and under 10 minutes, with no hand edits.
- **SC-002**: Upgrading the Neo4j version within a major version takes a one-line reviewed change and one documented
  step, and a failed upgrade is back to the previous state in under 10 minutes.
- **SC-003**: Every setting and plugin the running graph uses can be read in the repository, or is reported as a
  pending change by the status (FR-010); and CI fails on each disagreement listed in FR-012, each seen failing once.
- **SC-004**: After any documented step or a reboot, exactly one Neo4j holds the graph's port.
- **SC-005**: Each step is shown on a test copy, before the host, in its success path, its failure path, and an
  interruption part way.

## Assumptions

- The data folder stays at Neo4j's standard location, and a release's store keeps being delivered as a folder.
- The image is the vendor's published Neo4j Community image at the configured version (not a store baked into an image),
  so the version can change without rebuilding data.
- Restarting the node content service and Tomcat is acceptable during the step; it is what a release already needs.
- The version releases are built with is recorded by hand in the repository when it changes.
- The Java AnalysisService's analysis file is delivered with the release apart from the graph; this specification restarts
  Tomcat so it is read, and reports its release, but does not deliver it.
- A move to Neo4j 5 is out of scope beyond documenting it (FR-008).
