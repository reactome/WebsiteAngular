# Feature Specification: The graph database in a container, its version a setting

**Feature Branch**: `spec017/graphdb-container`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "The graph database (Neo4j) as a container over the host's data folder, with its version a setting, so the database version can be upgraded deliberately in future." Agreed with the project lead on 27 Oct 2026.

## Context

Every service on the host that reads Reactome's graph (the node content service, the Java
ContentService and AnalysisService, the MCP service) connects to one Neo4j on the loopback
interface, port 7687. Measured on 27 Oct 2026:

- **How a release arrives.** A release's graph store is delivered by copying its database
  folder into Neo4j's data folder (`data/databases/graph.db`). Its transaction logs do not come
  with it: Neo4j 4.x keeps them apart, in `data/transactions/`. Neo4j refuses such a store
  ("transaction logs are missing") unless it is told to start without them.
- **Which version can read it.** The store is written by the Neo4j version the release is built
  with (4.3.6 Community for release 98). A server can open a store from its own version or an
  earlier one in the same major version, upgrading it, which cannot be undone; it cannot open
  a newer store.
- **What serves today.** The compose service `graphdb` (a 4.4 image, with release 97's store in a
  named volume) is stopped. A Neo4j 4.3.6 installed on the host from the vendor's package
  repository serves release 98. It was set up by a script outside this repository, so its
  version, plugins and settings are recorded nowhere a reviewer can see, and changing its
  version means package-repository work by hand.

The project lead wants the database version to be something that can be upgraded deliberately,
not only today's release brought up.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A new release's graph comes up (Priority: P1)

An operator has copied a new release's graph store into the data folder. They run one documented
step. It brings the graph up on the new store, checks that the graph answers the new release
number, and restarts the services that hold the release in memory (the node content service and
Tomcat), checking each answers the new number. If the graph does not come up, nothing is left
half-switched: the operator is told why, and the previous state is still available.

**Why this priority**: it happens every release, and on 27 Oct 2026 it took an afternoon: a
setting the copied store needs was missing, and two services kept answering the old release
until they were restarted by hand.

**Independent Test**: on a test copy, put one release's store in place, run the step, and see the
graph and every service answer that release; then put a store in place that the server cannot
open and see the step stop with the reason and the previous graph serving again.

**Acceptance Scenarios**:

1. **Given** a release's store copied into the data folder without its transaction logs, **When** the
   operator runs the step, **Then** the graph opens it and answers the release number, and the node
   content service, the Java ContentService and AnalysisService each answer the same number.
2. **Given** a store the configured version cannot open (written by a newer Neo4j), **When** the
   operator runs the step, **Then** it stops, says the store is newer than the server, and the graph
   that served before serves again.
3. **Given** the step has run, **When** a page that shows the release is loaded, **Then** it shows the
   new release without any further restart.

---

### User Story 2 - The Neo4j version is upgraded deliberately (Priority: P1)

The release is to be built with a newer Neo4j (say 4.4 instead of 4.3). A maintainer changes the
version in one place in the repository, in a reviewed pull request, and an operator runs one
documented upgrade step on the host. The step first copies the data folder, then starts the new
version, which upgrades the store, and checks the graph and the services answer. If anything
fails, it puts back the copy and the old version.

**Why this priority**: the reason for this specification. Today a version change means
package-repository work on the host by hand, held back from every review.

**Independent Test**: on a test copy, upgrade from 4.3.6 to a 4.4 version and see the store upgrade
and the services answer; then simulate a failed start and see the copy and the old version restored
and answering as before.

**Acceptance Scenarios**:

1. **Given** the version setting changed within a major version, **When** the operator runs the upgrade
   step, **Then** a copy of the data folder is taken before anything changes, the new version starts and
   upgrades the store, and the graph and the services answer.
2. **Given** the new version fails to start or to answer, **When** the step sees it, **Then** it restores the
   copy, starts the old version, and reports what failed.
3. **Given** a change of major version (for example to 5.x), **When** someone looks for how to do it,
   **Then** the documentation says it is a deliberate migration of its own (a store migration, a new
   plugin version, and checking the services against it), and the upgrade step refuses to cross a major
   version.

---

### User Story 3 - What runs is what the repository says (Priority: P2)

A maintainer can read, in the repository, which Neo4j version runs, which plugins and settings it
has, and how it gets its password; and a check in CI fails when these disagree with each other or with
the recorded version the releases are built with.

**Why this priority**: the host installation of 27 Oct 2026 was configured by hand from a script outside
the repository; the next person cannot see or review it.

**Independent Test**: change the version setting without changing the recorded release-build version, and
see CI fail; change a required setting (the missing-logs one) and see CI fail.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a maintainer reads the graph's definition, **Then** the version, the
   plugins (each with its version and checksum), the settings and the source of the password are all
   there.
2. **Given** a version setting older than the recorded release-build version, **When** CI runs, **Then** it
   fails, saying the server could not open the release's store.
3. **Given** the setting that lets a copied store start without its transaction logs removed, **When** CI runs,
   **Then** it fails.

---

### User Story 4 - One graph at a time (Priority: P2)

Starting the stack never starts a second Neo4j competing for the graph's port, and the host installation is
retired once the container serves.

**Why this priority**: on 27 Oct 2026 a plain start of the whole stack would have started the old container
beside the host installation, both wanting port 7687.

**Independent Test**: run the documented start of the whole stack with the graph already serving, and see no
second Neo4j and no change to the one serving.

**Acceptance Scenarios**:

1. **Given** the graph serving, **When** the operator starts the whole stack as documented, **Then** exactly one
   Neo4j holds port 7687 afterwards.
2. **Given** the container serving the release, **When** the host installation is retired as documented, **Then**
   it no longer starts at boot and its package is removed or held off, and the data folder stays.

---

### Edge Cases

- The copied store is from a newer Neo4j than the configured version: refused, with that reason, the previous
  graph restored (User Story 1).
- The copied store is incomplete or corrupt: the graph does not answer; the step restores the previous state and
  says so.
- The data folder is owned by the host installation's user: the container must be able to read and write it, and
  the host installation, if still present, must not be able to start on it at the same time.
- The disk lacks room for the copy before an upgrade: the upgrade step refuses before changing anything.
- The password file is missing or holds no password: the graph refuses to start rather than starting without
  authentication (as the container does today).
- A reboot during any step: the graph that comes back is the one recorded as serving, never two.
- The services keep answering the old release after the step (they cache it): the step restarts them and checks
  each, rather than trusting the graph's answer alone.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The graph MUST run from a container image whose Neo4j version is a single setting in the repository.
- **FR-002**: The graph MUST use the host's Neo4j data folder, where a release's store is copied, not a container
  volume, so that a copied store is what it opens.
- **FR-003**: The graph's configuration MUST be in the repository: Bolt on the loopback interface only; memory;
  the default database `graph.db`; starting a store without its transaction logs; the plugins and their procedures.
- **FR-004**: The plugins MUST be pinned by version and checksum, and fetched or installed only from those.
- **FR-005**: The graph MUST take its user and password from the credentials file the services already use, read
  literally, and MUST refuse to start without them.
- **FR-006**: A documented, scripted step MUST bring a newly copied store up: start the graph on it, check it answers
  the release number, restart the services that hold the release in memory, check each answers it, and restore the
  previous state on failure.
- **FR-007**: A documented, scripted step MUST upgrade the Neo4j version within a major version: copy the data folder
  first, start the new version allowing the store upgrade, check, and on failure restore the copy and the old version.
- **FR-008**: The upgrade step MUST refuse a change of major version, and the documentation MUST describe that
  migration as separate work.
- **FR-009**: A documented, scripted step MUST roll back to the previous version and data copy.
- **FR-010**: Starting the whole stack MUST NOT start a second Neo4j or change the one serving.
- **FR-011**: The host installation MUST be retired once the container serves, by a documented step that keeps the
  data folder.
- **FR-012**: A check in CI MUST fail when the version setting is older than the recorded version releases are built
  with, when the required settings (FR-003) are missing, or when a plugin is unpinned.
- **FR-013**: No step may send a query to the graph beyond the release-number check and the services' own startup;
  the work is configuration (no load on the shared graph).
- **FR-014**: Nothing in the repository may name a host, a credential, or internal release-process detail; the
  credentials file stays outside it.

### Key Entities

- **Version setting**: the Neo4j version the graph runs, in one place, with the version releases are built with
  recorded beside it.
- **Data folder**: the host folder holding the graph's databases and transaction logs; where a release's store is copied.
- **Data copy**: a copy of the data folder taken before an upgrade, the way back from it.
- **Graph configuration**: the settings and pinned plugins the graph starts with.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Bringing a new release's copied store into service, with every service answering the new release,
  takes one documented step and under 10 minutes, with no hand edits.
- **SC-002**: Upgrading the Neo4j version within a major version takes a one-line reviewed change and one documented
  step, and a failed upgrade is back to the previous state in under 10 minutes.
- **SC-003**: Every setting and plugin the running graph uses can be read in the repository, and CI fails on each
  disagreement listed in FR-012, each seen failing once.
- **SC-004**: After any documented step or a reboot, exactly one Neo4j holds the graph's port.
- **SC-005**: Each step is shown on a test copy, before the host, in both its success and its failure path.

## Assumptions

- The data folder stays at Neo4j's standard location, and releases keep being delivered by copying the store into it.
- The image is the vendor's published Neo4j Community image at the configured version (not a store baked into an image),
  so the version can change without rebuilding data.
- Restarting the node content service and Tomcat is acceptable during the step; it is what a release already needs.
- The version releases are built with is recorded by hand in the repository when it changes; the release team tells the
  project lead.
- A move to Neo4j 5 is out of scope beyond documenting it (FR-008).
