# Specification Quality Checklist: The graph database in a container, its version a setting

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- This is an infrastructure feature: the thing specified is how the graph database runs, so Neo4j, its
  version, its data folder and the container are the subject, not an implementation choice. The spec names
  them for that reason and leaves the how (compose layout, script language, check mechanism) to the plan.
- No clarification was needed: the user decided the direction on 27 Oct 2026 (a container over the host data
  folder, the version a setting, upgrades deliberate, Neo4j 5 separate).
- Success criteria name times and counts an operator can see (steps, minutes, one Neo4j on the port), not
  internal metrics.
- Revised after #717's review: a new release's store is set aside rather than overwritten (so rollback has
  something to return to); the first container version equals the store's (FR-002a); the password in the
  system database is checked by a login (FR-005); the readers corrected (java-library reads the graph, MCP does
  not, AnalysisService follows its own file); store upgrade allowed for one start only; the missing-logs
  setting's limit stated; CI also refuses a different major version.
- Revised again after #718's review:
  - the database is set aside together with its transaction logs;
  - the missing-logs start and store upgrade are each allowed for one start of one step only;
  - a serving record on the host means a merged version setting changes nothing until the upgrade step runs (US4 AS 2);
  - a release step that fails after the services restart also restarts them on the restored database;
  - the counts check has a threshold;
  - older stores within the major version are handled;
  - ownership is restored on the way back.
- For the plan: whether the repository's graph entrypoint keeps refusing a user other than `neo4j`, and a password containing `/`, once the password comes from the system database.
- Revised a third time after #719's review:
  - the repository's setting is the version to run, and the host's applied configuration (version, plugins, settings) is what runs, with a status reporting the difference (FR-001, FR-010, US3 AS 4);
  - one-start allowances run on their own and are never restarted, and steps record their progress so an interruption is seen (FR-010a, US4 AS 3, SC-005);
  - the counts rule is in FR-006, taken from the serving database before it is set aside;
  - older stores have a scenario (US1 AS 4);
  - FR-009 names its three rollbacks;
  - the set-aside database is kept until the next release.
- From #720's review, after its merge: the set-aside database's lifetime agrees with FR-006; US1 AS 2 gives the
  reason a store cannot open; FR-007 is the step that applies any configuration change; progress is recorded before
  each change to the data folder or the applied configuration; SC-002 counts the plugin versions an upgrade brings;
  the data copy, FR-008 and FR-009 follow FR-007's wider scope.
- For the plan, open questions:
  - restoring a set-aside store older than an upgraded server;
  - the counts check when no database serves to count from (a fresh test copy; on the host, the host installation's
    database serves at the cut-over);
  - how an interruption is simulated on the test copy.
