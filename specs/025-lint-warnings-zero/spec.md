# Feature Specification: No lint warnings

**Feature Branch**: `025-lint-warnings-zero`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Clear the repository's ESLint warnings, ratcheted in lint-baseline.json (879 on 13 Nov 2026), to zero, and promote each warned rule to "error" as its count reaches zero, so that no new warning of that kind can be added. Most no-unsafe-\* warnings come from values typed `any`; the fix is to give those values real types, not to silence the rule. No behaviour change. Each PR small enough to review. No eslint-disable comments except where a third-party API makes a type impossible, each with a written reason. Small rules first, so they can be promoted to error early."

## Why

On 13 November 2026 the linter reports 879 warnings. A ratchet holds each rule's
count so it can only fall, but a warning still allowed is a problem still
allowed. Most of them (578) come from values the code treats as "anything": the
compiler checks nothing about them, so a misspelt field, a field that has moved
or a call on something that isn't there passes every check and fails only when a
user reaches it. Another 151 are places where the code asserts that a value is
present instead of handling its absence.

| Where                | Warnings | Files |
| -------------------- | -------- | ----- |
| The Pathway Browser  | 492      | 75    |
| The website          | 237      | 29    |
| The GSA form library | 105      | 31    |
| The table library    | 24       | 6     |
| The end-to-end tests | 21       | 10    |

| Kind of warning                                             | Count |
| ----------------------------------------------------------- | ----- |
| A value treated as "anything" (the five no-unsafe-\* rules) | 578   |
| Asserting a value is present (no-non-null-assertion)        | 151   |
| Declaring a value as "anything" (no-explicit-any)           | 96    |
| 11 smaller rules, 1 to 14 each                              | 54    |

## User Scenarios & Testing _(mandatory)_

The users of this work are the people who change the site: developers and the
agents working with them. The site's visitors see no difference.

### User Story 1 - The small rules can no longer be broken (Priority: P1)

A developer adds a button without a type, renames an input, or leaves a useless
assignment. Today that is a warning the ratchet tolerates as long as the total
doesn't rise; once this story is done, it is an error the check refuses.

**Why this priority**: the eleven small rules (54 warnings) are quick to clear,
and each one cleared is a rule that is enforced from then on. It is the
cheapest gain and makes the rest of the work visibly progress.

**Independent Test**: after this story, the eleven small rules show zero
warnings and each is at "error"; adding one violation of any of them fails the
lint check.

**Acceptance Scenarios**:

1. **Given** a rule whose count has reached zero, **When** the lint check runs,
   **Then** it reports that rule at "error" and fails on any new violation.
2. **Given** a fix to one of these warnings, **When** the existing tests run,
   **Then** they all pass, and the site behaves as before.

---

### User Story 2 - Values from the services have real types (Priority: P2)

A developer reads a field from a service's answer. Today, in many places, the
answer is typed as "anything", so a misspelt or moved field compiles and fails
only at run time. After this story, those answers carry the API contract's
types (or a library's own types), and the compiler refuses a field that isn't
there.

**Why this priority**: this is most of the warnings (578 unsafe uses and 96
declarations) and the most real protection: it is where a wrong field name
would otherwise reach a user.

**Independent Test**: for each area cleared (Pathway Browser, website, GSA
form, table, end-to-end tests), the five no-unsafe-\* rules and no-explicit-any
show zero warnings in that area, and the tests pass unchanged.

**Acceptance Scenarios**:

1. **Given** an area cleared of "anything" values, **When** a developer reads a
   field that the type doesn't have, **Then** the type check fails.
2. **Given** a type change that reveals the code was reading a field that
   doesn't exist or has a different shape, **When** it is found, **Then** the
   bug is fixed in its own commit, with a test that fails without the fix, and
   called out in the pull request.

---

### User Story 3 - Absent values are handled, not asserted away (Priority: P3)

A developer reads a value that may be absent. Today, in 151 places, the code
asserts it is present; if it isn't, the failure appears somewhere else, later.
After this story, each place either handles the absence or proves the value
can't be absent.

**Why this priority**: important but less urgent than the "anything" values:
the assertions are concentrated in the Pathway Browser (138) and each needs
reading in context.

**Independent Test**: no-non-null-assertion shows zero warnings and is at
"error"; the tests pass unchanged.

**Acceptance Scenarios**:

1. **Given** a value that can be absent, **When** it is absent, **Then** the
   code does what it did before in the cases that can happen, and a case that
   used to fail obscurely now fails clearly or is handled.

---

### Edge Cases

- **A library gives no usable type.** Where a third-party library's own types
  make a correct type impossible, the warning may be silenced on that line only,
  with a written reason naming the library and the limitation. Each such
  exception is listed in the pull request.
- **A type reveals a real bug.** The bug is fixed separately from the typing,
  with a test proved by mutation, and named in the pull request; it is not
  folded silently into a "lint" change.
- **Generated or recorded code.** Files that are generated, or test recordings,
  are not hand-edited to satisfy the linter; if any are linted, the rule's scope
  is narrowed instead, with the reason written down.
- **Other work in flight.** Other sessions change the same files at the same
  time. Each pull request is small, merges main before pushing, and the ratchet
  catches any new warning that arrives meanwhile.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The lint warning count MUST reach zero across the repository.
- **FR-002**: Each warned rule MUST be promoted to "error" in the pull request
  that clears its last warning, so that it can't come back.
- **FR-003**: A value typed "anything" MUST be given a real type: the API
  contract's type where the value is a service's answer, a library's own type
  where one exists, or a type of the code's own otherwise. Silencing the rule is
  not a fix.
- **FR-004**: A line may silence a rule only where a third-party library makes
  a correct type impossible, and only with a written reason on that line.
- **FR-005**: The site's behaviour MUST NOT change, shown by the existing unit
  and end-to-end tests passing unchanged.
- **FR-006**: A real bug found on the way MUST be fixed in its own commit, with
  a test that fails without the fix, and called out in the pull request.
- **FR-007**: Each pull request MUST lower the ratchet's per-rule counts to what
  it leaves, so that the gains are locked in.
- **FR-008**: Each pull request MUST be small enough to review in one sitting:
  one rule, or one rule in one area, or a few small rules together.

### Key Entities

- **A warned rule**: a lint rule at "warning", with a recorded count that can
  only fall; at zero it becomes an error.
- **An exception**: a single silenced line, with its reason, where a library
  makes a type impossible.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The lint warnings fall from 879 to 0.
- **SC-002**: All 18 rules warned today are errors, so a new violation of any of
  them fails the check.
- **SC-003**: No test is changed to make it pass, and every test that passed
  before still passes.
- **SC-004**: Silenced lines are few and each one is justified: no more than 20
  across the repository, each with its reason.
- **SC-005**: Every bug found on the way is listed, with the pull request that
  fixed it.

## Assumptions

- The rules and their settings stay as they are today; this work clears what
  they report, it doesn't loosen them or add new ones.
- The services' answers already have types in the API contract
  (`projects/contract`, spec 016) for most of what the site reads; where one is
  missing, adding it follows that spec's rules (the type follows what the
  service writes, measured).
- The node services under `tools/` are outside this count: they have their own
  ratchet (`tools/loose-baseline.json`, already at zero).
- The work happens alongside other sessions' work on the same files; small pull
  requests and the ratchet keep the two from colliding.
- Order: the small rules first (User Story 1), then the "anything" values area
  by area, smallest area first (User Story 2), then the asserted values (User
  Story 3).
