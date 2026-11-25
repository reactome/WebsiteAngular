# Feature Specification: The release server runs the site's stack

**Feature Branch**: `spec032/release-server`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: the release server, where each release is built and checked
before it reaches production, runs this repository's stack from `main`, as beta does. The
stack's web server takes the public ports there, and the server's old web server is
retired. The release's PDF step (pdf-export) needs this: it draws its figures through the
render service and a content service of the same release, and both must run on that server.

## Decisions already made

Made by the project's owner, 24 Nov 2026, and not reopened by this spec:

- **D1.** The release server runs the stack from `main`, as beta does: Tomcat and Solr on
  the host, the newer services in containers.
- **D2.** The stack's web server takes ports 80 and 443 there; the old web server is retired.
- **D3.** Tomcat stays (the analysis service, and the content routes still answered in Java).
- **D4.** The host's own graph database stays, because the release's pipelines use it. The
  stack's graph container is left out on that server. It is Neo4j 4.3, the version beta's
  graph container runs (first read as older; checked on 24 Nov 2026, research R3), so what
  must be checked is the next release's data in it, not the version.
- **D5.** `/download/...` sends readers to the download site, for that release, not to a
  local folder.
- **D6.** The old site's expression widget route, the curator applications and Reacfoam's
  old build are not carried over.
- **D7.** The server's other sites, and the path of its build service, stay on that server.
  They are configured there, not in this public repository.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The release is checked on its own server, through the new site (Priority: P1)

A curator or developer checking a release opens the release server's address and gets the
new site, reading that release's graph: pages, the Pathway Browser, search, analysis and
downloads, as on beta.

**Why this priority**: the release is checked on that server before it reaches production;
it should be checked in the site that production will run.

**Independent Test**: with the stack running beside the old web server (nginx not yet
started), the site and the content service answer on their loopback ports from that
server's release; then, once the old web server is switched off and the stack's web
server takes the public ports, the site, a pathway, a search, an analysis and a download
link, each answered from that server's release. (A spare-port trial was planned, but the
stack's web server needs the public ports; T014.)

**Acceptance Scenarios**:

1. **Given** the stack running on the release server, **When** a reader opens the home page
   and a pathway, **Then** both come from that server's release, and the site names its
   version.
2. **Given** the same, **When** a reader starts an analysis, **Then** it runs on that
   server's analysis service and its results open.
3. **Given** the same, **When** a reader follows a download link, **Then** they reach the
   download site's files for that release (D5).
4. **Given** a content route still answered in Java, **When** it is asked for, **Then** the
   server's Tomcat answers it, as on beta (D3).

---

### User Story 2 - The release's PDF step can run there (Priority: P1)

The release's PDF step draws every figure of the book through the render service, which
reads the release's own files and a content service of the same release. With the stack
on the release server, the step has both, at addresses it is told.

**Why this priority**: this is what started the work. Without it the book cannot be made
by the release.

**Independent Test**: on the release server, the render service's health reports that it
reads local files and the release's content service; a short run of the figures step
against a handful of pathways writes their figures.

**Acceptance Scenarios**:

1. **Given** the stack running, **When** the figures step is given the render service's and
   the content service's addresses, **Then** it draws figures of that release, from that
   server's files.
2. **Given** a release step that stops Tomcat, **When** it is running, **Then** the PDF step
   does not run at the same time (a rule on the release's job, set where the jobs are kept).
3. **Given** the server's memory, **When** the figures step runs beside everything else,
   **Then** what each part uses is known beforehand, so it can be planned for (FR-010).

---

### User Story 3 - The server's other sites keep working (Priority: P2)

The release server also serves a wiki, a host that only redirects, and the web pages of its
build service. Retiring the old web server must not break them.

**Why this priority**: they are in daily use; the cutover cannot leave them dark.

**Independent Test**: through the stack's web server, after the switch, the wiki's pages
(including an upload up to its present limit), the redirect, and the build service's pages
(including a long request) work as they do today.

**Acceptance Scenarios**:

1. **Given** the stack's web server, **When** the build service's path is opened, **Then**
   its pages, logins and long requests work, and the addresses it writes are the public ones.
2. **Given** the same, **When** the wiki is opened and a file is uploaded, **Then** both
   work, with the same size limit as today.
3. **Given** the same, **When** the redirect host is opened, **Then** it redirects as today.
4. **Given** a host name the server does not serve, **When** it is asked for, **Then** the
   answer is the stack's refusal, as now.

---

### User Story 4 - Certificates renew without the old web server (Priority: P2)

The server's certificates renew today through the old web server. After the cutover they
must still renew.

**Independent Test**: a renewal dry run for each certificate passes with the old web server
stopped.

**Acceptance Scenarios**:

1. **Given** the old web server stopped, **When** each certificate's renewal is tried as a
   dry run, **Then** it passes.

---

### Edge Cases

- **The graph is the next release's, on the host's database (D4).** An endpoint that works
  on beta might fail, or answer differently, against it (a missing index, a changed
  model). Each difference found is fixed, or listed with
  its reason (FR-006).
- **Not enough memory.** The server has far less free memory than the stack uses on beta.
  The stack must not start in a state where the release's own jobs run out of memory; what
  is cut is the owner's decision, made from measurements (FR-010).
- **Tomcat stopped by a release step.** While it is stopped, the site's Java routes and the
  analysis service fail. The site shows its usual failure messages, and the PDF step waits
  (User Story 2, scenario 2).
- **A pull or a build fails on the server.** The running stack stays as it was; nothing is
  half-replaced.
- **`main` moves while the server updates.** The server takes one commit's images
  together, never a mix of two commits.
- **The release's files for the next release are not yet in place.** The stack reads the
  folder it is told; a missing file is a 404, never a request to production.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The release server MUST get the stack's images without building the site
  there: its free memory is far below what building the site takes. The images are
  published from `main` by the repository's CI to the project's public registry, each
  tagged with its commit and as the latest, and the server pulls them. The exception is an
  image holding code we may not redistribute (the Java library, whose graph library
  declares no licence): it is never published, and is built on the server from the commits
  it pins, with nothing on the host but a container runtime.
- **FR-002**: The site itself MUST run as a container in production form, serving what beta
  serves, so the server needs no host language runtime.
- **FR-003**: The repository MUST document, as an example kept outside the deployed files,
  the settings a server like this one keeps for itself: no graph container; the host's
  graph database, its address and database name; the graph's credentials through the
  existing settings-file mechanism (never in the repository); the release's files folder
  for diagrams and release files; the certificates' folder.
- **FR-004**: The release server's web server configuration MUST include a server-local
  folder of extra configuration, empty in the repository. The build service's path and the
  other sites are configured there (D7).
- **FR-005**: `/download/...` MUST send the reader to the download site's copy for the
  release (D5).
- **FR-006**: The content service and the Java library MUST be checked against the host's
  graph database (D4): connection, and a spot check of endpoints compared with
  beta's answers for the same release. Each difference is fixed or listed with its reason.
- **FR-007**: The repository MUST give examples of the server-local configuration (the build
  service's path with the headers and limits it needs, a wiki with its scripting runtime, a
  redirect host), documented, not deployed from the repository.
- **FR-008**: Certificate renewal MUST NOT depend on the old web server: the stack's web
  server serves the renewal challenge path, and the documentation says how to move each
  certificate's renewal to it.
- **FR-009**: The repository MUST say what the release's PDF step is given on that server:
  the render service's address, the content service's address, and the render service's
  concurrency, and that the step never runs while Tomcat is stopped.
- **FR-010**: The memory each part of the stack uses MUST be measured, at rest and during the
  figures step and the book, and recorded, so the owner can decide what to cut.
- **FR-011**: Nothing server-specific goes into the repository: no host names beyond the
  public release address already in it, no paths of that server, no credentials, no sizes
  of that server.

### Key Entities

- **Server-local settings**: the override of the stack's services and its settings file,
  kept on the server.
- **Server-local web configuration**: the folder of extra web server configuration, kept on
  the server.
- **The release's files folder**: the release's diagram, illustration and download files the
  render and content services read.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Once the old web server is switched off, through the stack's web server on
  the release server, the site, a pathway, a search, an analysis, a
  download link, the build service's pages, the chat and the wiki all work.
- **SC-002**: The server runs `main`'s images: every published image is pulled at the
  commit `main` names, and the Java library builds there with only the container runtime on
  the host. No image published holds code we may not redistribute.
- **SC-003**: A spot check of at least 30 content endpoints, against the host's graph
  database, answers as beta does for the same release, or each difference is listed with
  its reason.
- **SC-004**: Each certificate's renewal dry run passes with the old web server stopped.
- **SC-005**: The figures step draws a sample of figures on the server, through its render
  service, with no request to production.
- **SC-006**: A search of the repository finds none of the server-specific details FR-011
  forbids.
- **SC-007**: The memory of each part, at rest and at peak, is recorded before cutover.

## Assumptions

- The session with access to the release server can create the registry's repositories and
  the access the repository's CI needs to publish to them (the user, 24 Nov 2026).
- The user installs host packages on the server (a scripting runtime for the wiki, if the
  wiki stays on the host), and does the cutover: stopping the old web server and starting
  the stack's on the public ports.
- The session with access to the release server brings the stack up beside the old web
  server, tests it, and sets the release's PDF job; this repository provides what it runs.
- The chat services already run in containers on that server; the stack's web server routes
  to them as it does on beta.
- The release's graph for the next release is loaded on the host's database before the
  stack is pointed at it.
