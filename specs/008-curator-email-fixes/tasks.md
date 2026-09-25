---
description: 'Task list for the curator email review of 25 September'
---

# Tasks: Curator email review, 25 September

**Input**: Design documents from `/specs/008-curator-email-fixes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/ui-contract.md](./contracts/ui-contract.md),
[quickstart.md](./quickstart.md)

**Tests**: Required. Constitution III — every code fix has a test that is run against the
current code and **shown failing before the fix is written**. Content fixes are covered by
the link-integrity check (T035), itself shown catching a known-broken link first.

**Organization**: Phases follow the plan's **waves** — certainty and ease of verification
first, decisions last — as the user asked, rather than one phase per story. Every task
carries its story label, so each story's work can still be read out by filtering:

| Label | Story (spec.md)                                        | Items                  |
| ----- | ------------------------------------------------------ | ---------------------- |
| US1   | An analysis result can be trusted (P1)                 | 3a, 3b, 3c             |
| US2   | Every link and download does what it says (P1)         | 1b, 1e, 1g, site-wide  |
| US3   | The pathway browser shows what reactome.org shows (P2) | 2a, 2c, 2d, 2e, 2f, 2g |
| US4   | Content is current and belongs to this site (P2)       | 1a, 1c, 1d, 1f         |
| US5   | The pathway overview offers a node view (P3)           | 2b                     |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- Paths are repository-relative. `PB` = `projects/pathway-browser/src/app`,
  `WA` = `projects/website-angular`, `CT` = `projects/website-angular/content`.

## Rules that apply to every task

- Use Node 24, as `.nvmrc` asks.
- **Run e2e with `E2E_PORT` set.** Without it the suite reuses whatever already
  serves port 4200, which may be a deployed build rather than this tree
  (`playwright.config.ts` explains).
- **Verify by the visible outcome, never by HTTP status.** The SPA answers 200 for a
  missing page; a missing page shows the heading "We can't find that page".
- **Before any beta check**, `curl -s https://beta.reactome.org/health` and confirm
  `bundle`/`built` postdate the merge. A merged PR is `FIXED-PENDING-DEPLOY`, not `FIXED`
  ([data-model.md](./data-model.md)).
- **Ratchets**: `npm run check:lint` ≤ 652 warnings, `npm run check:dead` ≤ 145. Neither
  may rise in any wave.
- **Public repository**: no curator names, email text or internal process in code,
  comments, commits or PR bodies. The review tracker is kept outside the repo and holds the detail.
- **Don't hammer idg.reactome.org** in tests; e2e uses recorded fixtures (`E2E_RECORD=1`
  only when a fixture must be re-recorded, once).
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Squash merge; update
  branch with `gh pr update-branch` and merge PRs serially (strict protection).

---

## Phase 1: Setup

**Purpose**: a known-good starting point for every wave.

- [x] T001 `git fetch origin` and confirm `008-curator-email-fixes` is based on current `origin/main` (rebase if not); record the base commit in the review tracker
- [x] T002 Run the full gate on the base and record each number as the wave-0 baseline: `npm test && npm run check:types && npm run check:lint && npm run check:dead && npm run format:check && npm run e2e` (lint 652 / dead 145 expected; any difference is investigated before starting, not absorbed)
- [x] T003 _(Health captured; the before state is recorded as the red e2e runs against the pre-fix code rather than as screenshots.)_ Capture beta's current state for the before/after record: `curl -s https://beta.reactome.org/health` into the tracker, and screenshot the 12 quickstart checks as they fail today (store under the scratchpad, reference paths from the tracker)

---

## Phase 2: Foundational

**Purpose**: nothing blocks all stories. The one shared piece — the link-integrity check —
is needed only by the link and content work, so it opens Wave 2 (T035) instead of
blocking Wave 1.

**Checkpoint**: Setup done → Wave 1 can start.

---

## Phase 3: Wave 1 — certain and easy to verify (rank 1)

**Goal**: land every rank-1 fix in one PR, deployed and verified, before anything that
needs judgement.

**Independent test**: quickstart rows 1a, 1b, 1f, 2c, 2f, 3c pass on beta; an unloadable
analysis token shows a message.

### 1a — Digital Preservation heading (US4)

- [x] T004 [P] [US4] Add an e2e test in `e2e/content-pages.spec.ts`: `/about/digital-preservation` shows an `h1` reading "Digital Preservation" and the page text contains no "Untitled" (case-insensitive). Run it against current code and **record it failing**
- [x] T005 [US4] In `CT/about/digital-preservation.mdx` set frontmatter `title: Digital Preservation`, and mend the split link (`[GitHub](...) [r](<https://github.com/reactome-pwp/>)epository`) into a single link over "GitHub repository"; confirm T004 passes
- [x] T006 [P] [US4] Guard against recurrence: add a unit test beside `WA/src/scripts/generate-index.ts` (or `stage-content.ts`, whichever reads frontmatter) that fails when any `.mdx` under `CT/` has a missing, empty or `Untitled` title; show it failing by temporarily reverting T005, then restore

### 1b — Logo downloads (US2)

- [x] T007 [P] [US2] Add an e2e test `e2e/downloads.spec.ts` (logo section): on `/about/logo` every option anchor has a `download` attribute and an `href` whose file exists under `WA/public/` (resolve the path on disk — do not fetch). **Record it failing** (0 of 16 have `download`; two targets missing)
- [x] T008 [US2] `git mv` `WA/public/uploads/about/logo/Reactome_Imagotype_Positive_50mm.png.png` → `…_50mm.png` and `…_100mm.png.png` → `…_100mm.png`; confirm both open as PNG (`file` reports PNG image data) and their pixel sizes match the Medium/Large labels
- [x] T009 [US2] Add `download` to all 16 anchors in `WA/src/app/about/logo-page/logo-page.component.html`; do **not** copy reactome.org's off-by-one isotype filenames
- [x] T010 [US2] _(Changed: the file is not dead — site search indexes it — so it was kept and trimmed to prose, with no links.)_ Delete dead `CT/about/logo.mdx` (the route in `WA/src/app/app.routes.ts:35` renders the component, not this file); confirm nothing else references it (`grep -rn "about/logo" CT WA/src`); confirm T007 passes

### 1f — Inferred-events chart and V95 references (US4)

- [x] T011 [P] [US4] Add a unit test for the `{release}` substitution in `WA/src/app/page/page.component.ts` (lines ~59–83) proving an image `src` containing `{release}` is rewritten to the current release; if substitution already works, the red test is instead an e2e assertion in `e2e/content-pages.spec.ts` that `/documentation/inferred-events` shows an image whose `src` contains the current release number — **record it failing** against the static `inferred-events.png`
- [x] T012 [US4] In `CT/documentation/inferred-events.mdx:24` replace the static `inferred-events.png` with `https://download.reactome.org/{release}/stats/reaction_release_stats.png`; confirm that URL resolves for release 97 before relying on it (look at the image: title must read "Reactome Version 97"); remove the stale local PNG if nothing else references it
- [x] T013 [P] [US4] Update the stated release in `CT/documentation/curator-guide.mdx:8` and `CT/documentation/release-documentation.mdx:8` from V95 to V97; then `grep -rn "V9[0-6]\b\|Version 9[0-6]" CT/documentation` and fix any other stale "current release" statement (historical references stay)

### 2c — Circadian clock EHLD (US3)

- [x] T014 [P] [US3] Extract the EHLD insertion into a pure function in `PB/ehld/ehld-svg.ts` (`parseEhldSvg(text): SVGSVGElement`, throws on `parsererror`) and write `PB/ehld/ehld-svg.spec.ts` first with a fixture containing a self-closing `<div/>`-style element that HTML parsing mis-nests (reduce it from the real R-HSA-9909396 SVG). Write the test against the current behaviour (`innerHTML`) and **record it failing** (elements after the self-closing tag end up nested/missing)
- [x] T015 [US3] Implement `parseEhldSvg` with `new DOMParser().parseFromString(text, 'image/svg+xml')`, check for `parsererror`, and in `PB/ehld/ehld.component.ts:105` replace `innerHTML = …` with `replaceChildren(document.importNode(doc.documentElement, true))`; surface a parse error to the reader instead of a blank panel; comment names the failure (Constitution V)
- [x] T016 [US3] Chase the related call sites found in research — `svg-exporter.service.ts:157`, `ehld.service.ts:468`, and `render.component.ts:59` — and switch each that inserts SVG via `innerHTML` to the same helper; for any left as is, state why in the PR body
- [x] T017 [US3] Measure before/after EHLD load time on R-HSA-9909396 and one large EHLD in the browser (Performance panel or `performance.now()` around insertion); record both numbers in the PR; no regression allowed

### 3c — Analysis summary outliving its analysis (US1)

- [x] T018 [P] [US1] In `PB/analysis-summary/summary.service.spec.ts` add a test reproducing the reader's path: service holds a summary for token A; a **new component instance** is created (the viewport destroys and recreates the panel — `viewport.component.ts:254`, `viewport.component.html:348`) with token B; assert the summary is cleared. **Record it failing** against the current per-instance `previous` logic (`analysis-summary.component.ts:219-222`) — extract that decision into a pure function first if the component can't render under vitest
- [x] T019 [US1] Expose the token the service holds as `heldFor()` in `PB/analysis-summary/summary.service.ts` (from `_lastToken`); in `analysis-summary.component.ts` clear when `heldFor() !== token`, following `search-answer.component.ts:285-293`; delete the per-instance `previous`; the comment names #278's per-instance check as the thing that did not cover this path
- [x] T020 [US1] Add a close control to `PB/analysis-summary/analysis-summary.component.html` (icon button, `aria-label="Close summary"`, keyboard reachable) that clears the summary and leaves results in place; add an e2e step in `e2e/analysis-results.spec.ts` that runs one example, summarises, runs a second, and asserts no summary text from the first remains, then summarises again and closes it. Record the e2e failing on current code before T019/T020 land

### 2f — GO biological process in Details (US3)

- [x] T021 [P] [US3] Add an e2e test in `e2e/detail-contents.spec.ts`: `/PathwayBrowser/R-HSA-109582?tab=description` shows "blood coagulation" linked with `GO:0007596`, and a pathway without a GO term shows no GO row. **Record it failing**
- [x] T022 [US3] Add a "GO biological process" row in `PB/details/tabs/description-tab/description-overview/description-overview.component.html` rendering the event's `goBiologicalProcess` with the existing `cr-ontology-term` component, shown only when present; confirm the field arrives in the event payload (look at the response, don't assume the name)

### 3b (part) — Unloadable analysis token must not vanish silently (US1)

- [x] T023 [P] [US1] Add a unit test for the analysis-load error path (extract the decision from `PB/services/analysis.service.ts:460` into a testable function if needed): a token that returns 410 produces a reader-visible message state, not `analysis = null` with nothing shown. **Record it failing** against `effect(() => this.resultResource.error() && this.state.analysis.set(null))`
- [x] T024 [US1] Replace the silent drop at `PB/services/analysis.service.ts:460` with an error state the viewport renders ("This analysis result could not be loaded — it may have expired or been produced on another server"), keep the token out of the state as today, and log the status; add an e2e with a recorded 410 fixture in `e2e/analysis-results.spec.ts`

### Wave 1 close-out

- [x] T025 Run the full gate (T002 command); lint ≤ 652, dead ≤ 145; format clean
- [x] T026 Open the Wave 1 PR from `008-curator-email-fixes` (body: each item, its cause, its red→green test; no internal detail)
- [x] T027 **Adversarial review** of the Wave 1 diff before merging: name every inference, chase each changed function's call sites, re-run each new test against the pre-fix code to prove it fails, look for silent fallbacks, check a11y of the close button; fix every finding in the PR and re-review
- [x] T028 Merge (squash), then `git log origin/main` to confirm the merge commit is on main; never push follow-ups to the merged branch
- [x] T029 Deploy: on main, `npm run build:beta`; restart the site; confirm `/health` bundle postdates the merge
- [x] T030 [P] [US4] Verify 1a and 1f on beta by visible outcome (heading; chart titled "Reactome Version 97")
- [x] T031 [P] [US2] Verify 1b on beta: click each of the 16 options, each saves a file; Medium and Large positive PNGs open as images
- [x] T032 [P] [US3] Verify 2c and 2f on beta: R-HSA-9909396 coloured pills, arrows, labels, no blue square; R-HSA-109582 shows "blood coagulation (GO:0007596)"
- [x] T033 [P] [US1] Verify 3c and 3b-part on beta: two analyses leave no trace of the first summary; close works; a GSA token from beta shows the new message
- [ ] T034 Update `CURATOR-REPORT.md` and `RELEASE-TESTING.md` for the Wave 1 items; move each tracker entry to `FIXED` with evidence (or back to `INVESTIGATING` if beta disagrees)

**Checkpoint**: Wave 1 verified on beta.

---

## Phase 4: Wave 2 — certain, one small judgement (rank 1–2)

**Goal**: readable analysis forms; no broken internal link anywhere in content.

**Independent test**: 3a readable at 1280×720 and 1366×768; link-integrity check reports 0.

### Link-integrity check (US2, shared with US4)

- [x] T035 [US2] Write `WA/src/scripts/check-links.ts` + `npm run check:links`: extract internal links from all `CT/**/*.mdx`, nav options and app templates, and resolve each **against a content file, a route in `WA/src/app/app.routes.ts`, or a file under `WA/public/`** — never by fetching (a fetch of a missing page returns 200). Report file:line per broken link. State its limits in its header (bound template values, `#anchors`, external links not checked)
- [x] T036 [US2] Prove the instrument: run T035 on current content and confirm it finds the 73 known-broken links (and specifically the V97 news links in `CT/about/news/295-v97-released.mdx`); reconcile any count difference before trusting it. Add `WA/src/scripts/check-links.spec.ts` with one known-good and one known-broken fixture link

### 3a — Example button names (US1)

- [x] T037 [P] [US1] Add an e2e test in `e2e/analysis.spec.ts` at viewport 1366×768 and 1280×720: on the qualitative form every example button's full label is visible (`scrollWidth <= clientWidth` for its label). **Record it failing** (container query `qualitative-analysis.component.scss:176-186` forces two columns; `:167-172` nowrap+ellipsis)
- [x] T038 _(Built differently: one column always, compact on short screens, names wrapping — so no tooltip is needed, since no name is ever cut.)_ [US1] In `PB/viewport/analysis-form/qualitative-analysis/qualitative-analysis.component.scss` switch to two columns only when each column can hold its label (width-based container query, not max-height), allow labels to wrap, and add a full-name `matTooltip` on each button in the matching `.html`
- [x] T039 [US1] Apply the same to species names in `PB/viewport/analysis-form/species-analysis/species-analysis.component.scss:120-125`; extend T037 to cover them (record failing first)

### Site-wide broken links (US2)

- [x] T040 _(Built differently: "Training and learning materials" now leads to the Documentation page\'s training section, which every heading can now be linked to.)_ [P] [US2] Fix the 13 `/community/training` links → `/community/outreach` across `CT/` (it is also missing on reactome.org)
- [x] T041 [P] [US2] Fix `/what-is-reactome` ×6 → `/about/what-is-reactome`, `/license` ×3 → `/about/license`, `/icon-lib` ×3 → `/community/icon-lib`, `/content/contributors` → `/community/contributors`, `/user/guide/…` and `/user/reactome-fiviz` → `/documentation/userguide/…`, `…/diagram/js` and `…/pathways-overview/js` (drop `/js`), and the two links ending in a full stop inside the URL (`…/dev/analysis.`, `…/dev/content-service.`)
- [x] T042 _(Changed: the `.xmi` is committed; the five training PDFs, 26 MB, are too large for the repository and go to the download bucket instead — listed in `KNOWN_BROKEN` until they are published.)_ [P] [US2] Copy the 5 `/docs/training/*.pdf` files and `reactome-interfaces.xmi` from reactome.org into `WA/public/` at the paths content links to; confirm each opens as the expected type (`file`), and that the licence permits redistribution (it is Reactome's own material)
- [x] T043 _(Done as `KNOWN_BROKEN` in `check-links.ts`, each with its reason. `/reacfoam` now points to `/PathwayBrowser`: the genome-wide overview is the browser\'s opening view.)_ [US2] Leave `/gsa/home` (blocked on decision 4) and `/reacfoam` (needs a target — propose one in the PR, default `/PathwayBrowser/`) listed in the check as known exceptions with a reason; the exception list lives in `check-links.ts`, not in a comment
- [x] T044 _(The check runs inside `npm test` via `check-links.spec.ts`, so CI fails on a new broken link.)_ [US2] Add `npm run check:links` to the gate (package.json and CI) so a new broken link fails the build; confirm by adding a broken link locally, seeing it fail, removing it

### 1d related — broken news images (US4)

- [x] T045 [P] [US4] Fix the three news items that put a web-page URL in an image tag: `CT/about/news/286-new-publication-in-nar-2026.mdx:16` (also mangled host `pubmed-ncbi-nlm-nih.gov`), `CT/about/news/288-…-two-new-ai-focused-preprints.mdx:14`, `CT/about/news/273-coretrustseal-news.mdx:18` — make each a link, or use the real image if one exists; extend T035 (or a sibling check) to flag `<img>`/`![]()` sources that point at HTML pages or non-image extensions, and show it catching these three first

### Wave 2 close-out

- [ ] T046 Full gate + `npm run check:links` reports 0 unexplained; ratchets hold
- [ ] T047 Open Wave 2 PR; **adversarial review** (spot-check 10 fixed links by opening the target content file; confirm no link now depends on a redirect; confirm the copied PDFs are the real files); fix findings; merge; confirm on main
- [ ] T048 Deploy (`npm run build:beta`), confirm `/health`, then verify on beta: 3a at 1366×768 all labels readable [US1]; a sample of 10 fixed links each opens a real page (no "We can't find that page") [US2]; the three news items show no broken image [US4]
- [ ] T049 Update `CURATOR-REPORT.md`, `RELEASE-TESTING.md` and the tracker (related findings linked to 1d and 1e)

**Checkpoint**: Wave 2 verified on beta.

---

## Phase 5: Wave 3 — certain cause, contained design (rank 2)

**Goal**: current spotlights, working V97/V96 news, orthologous events, EHLD hierarchy hover.

**Independent test**: quickstart rows 1c, 1e, 2d, 2g pass on beta.

### 1c — Research Spotlight (US4)

- [ ] T050 [P] [US4] Add a guard test for `WA/src/scripts/generate-index.ts` (`generate-index.spec.ts`): two entries with the same title/date in one collection fail the build with both file names. **Record it failing** against the current tree (40 `blogpost-*.mdx` duplicates in `CT/content/reactome-research-spotlight/`)
- [ ] T051 [US4] Implement the duplicate guard in `generate-index.ts`; then delete the 40 `blogpost-*.mdx` duplicates — for each, confirm its twin exists with the same body before deleting (diff them; if a duplicate carries content the twin lacks, merge it into the twin first)
- [ ] T052 [US4] Import the two missing spotlights verbatim from reactome.org as `294-central-role-of-glycosylation-…-omicron-variants.mdx` (22 May 2026) and `296-ten-common-mistakes-that-could-ruin-your-enrichment-analysis.mdx` (6 July 2026), matching the frontmatter of neighbouring files; copy their images locally; link pathways by stable id (Constitution IV)
- [ ] T053 [US4] Replace the hard-coded intro at `WA/src/app/article/article-page/article-page.component.ts:59` with reactome.org's text ("Each month, Reactome highlights a recently published scientific article…"), with "Reactome home page" linking to `/`
- [ ] T054 [US4] E2E in `e2e/content-pages.spec.ts` (record failing first): the spotlight list shows the intro, first card dated 6 July 2026, no title twice; the home page spotlight tile (`home-spotlight.component.ts:45`) shows the 6 July article

### 1e — V97/V96 news links and legacy redirects (US2)

- [ ] T055 [P] [US2] E2E in `e2e/legacy-links.spec.ts` (record failing first): each legacy path with a clear new home (`/what-is-reactome`, `/userguide`, `/userguide/reactome-fiviz`, `/dev`, `/beta/PathwayBrowser`) lands on a page whose heading matches the new home — assert content, not status
- [ ] T056 _(The link fixes landed in wave 2 with the site-wide pass; this task keeps the redirects.)_ [US2] Fix the "other news" links in `CT/about/news/295-v97-released.mdx` (lines 24, 26, 28, 32) and the same links in `CT/about/news/291-v96-released.mdx` to current paths; `/gsa` stays for decision 4
- [ ] T057 [US2] Add redirects for those legacy paths in `WA/src/app/app.routes.ts` (`redirectTo`, placed before the wildcard); check nginx `deploy/nginx/common/routes.conf` doesn't intercept any of them first; confirm T055 and `check:links` pass

### 2g — Orthologous events and "Computationally inferred" (US3)

- [ ] T058 [P] [US3] Look at the event payload for R-HSA-109582 and R-MMU-1640170 and record the exact fields (`orthologousEvent`, `isInferred`, `evidenceType`, `inferredFrom`) and their shapes before writing code
- [ ] T059 [P] [US3] E2E in `e2e/detail-contents.spec.ts` (record failing first): R-HSA-109582 lists orthologous events by species including Mus musculus, linked by stable id; R-MMU-1640170 shows "Computationally inferred" and "Inferred From: Cell Cycle"
- [ ] T060 [US3] In `PB/details/tabs/description-tab/description-tab.component.ts` add an "Orthologous events" section keyed on the event's `orthologousEvent` (the existing Inferences section at :670-674 is keyed on the PE property `DataKeys.INFERRED_TO` and never matches events), grouped and sorted by species, links by stId; add the "Computationally inferred" line when `isInferred`/`evidenceType` says so; measure render time for R-HSA-109582 before/after
- [ ] T061 [US3] Check the same gap on the content detail page (`/content/detail/…`) which shares these panels; fix there too if it renders separately

### 2d — Hierarchy hover highlights the EHLD region (US3, #297)

- [ ] T062 [P] [US3] Unit test (record failing first): setting the shared hover signal to a subpathway's stId causes the EHLD to mark the matching region hovered, and clearing it unmarks it; test the pure mapping in `PB/ehld/` if the component can't render under vitest
- [ ] T063 [US3] Add a root hierarchy-hover signal (service in `PB/services/`), set/cleared from `onTagHover` in `PB/event-hierarchy/event-hierarchy.component.ts:523-530` (keep the local `isHovered`); in `PB/ehld/ehld.component.ts` apply the existing EHLD hover style to the region for that stId; selection must be unaffected
- [ ] T064 [US3] E2E on `/PathwayBrowser/R-HSA-1640170`: hover "Cell Cycle Checkpoints" (R-HSA-69620) in the tree → its region gets the hover class; mouse leave → cleared

### Wave 3 close-out

- [ ] T065 Full gate + `check:links`; ratchets hold
- [ ] T066 Open Wave 3 PR; **adversarial review** (diff every deleted spotlight against its twin; confirm imported spotlights match reactome.org word for word; chase every consumer of the event payload the orthologous section reads; confirm hover signal clears on route change); fix findings; merge; confirm on main
- [ ] T067 Deploy, confirm `/health`, verify on beta: 1c list and home tile [US4]; each V97 other-news link and each legacy path [US2]; 2g on both pages [US3]; 2d hover glows and clears [US3]
- [ ] T068 Update `CURATOR-REPORT.md`, `RELEASE-TESTING.md`, tracker; comment on and close #297 once verified on beta

**Checkpoint**: every rank 1–2 item verified. Implementation stops here if no decisions have arrived.

---

## Phase 6: Wave 4 — needs the user's decision (rank 3)

**Goal**: finish items whose shape is the user's call. Each task names the decision it
waits on (plan.md "Decisions needed", numbered 1–6). Ask all open decisions together
once, then build whichever are answered.

- [ ] T069 Present decisions 1–4 to the user together (with a recommendation each) and record answers in the tracker; do not start T070–T077 until the relevant one is answered

### 2e — Subevent hover in the ELV (US3) — blocked on decision 1 (yellow highlight vs global hover colour)

- [ ] T070 [US3] Unit/e2e test (record failing first): hovering a subevent row in the hierarchy highlights its nodes in the diagram (R-HSA-549364 within R-HSA-1368108) in the decided colour
- [ ] T071 [US3] Drive the diagram highlight from the shared hover signal (T063) in `PB/diagram/diagram.component.ts`; colour per decision 1 — a dedicated highlight token, or change `--hover-node` (`projects/pathway-browser/src/styles.scss:216-217`) in both themes; check contrast in light and dark

### 2a — Tour and layout controls (US3) — blocked on decision 2 (video vs guided tour; layout toggles in the EBI-designed bar)

- [ ] T072 [US3] E2E (record failing first): the top bar offers Tour and Layout; Tour opens as decided; each layout toggle shows/hides its panel and the state survives reload if reactome.org's does
- [ ] T073 [US3] Implement in `PB/viewport/viewport.component.html` (~262–305) per decision 2; the placement is EBI's design — if the decision diverges from production, confirm it with the user rather than choose
- [ ] T074 [US3] Keep the GSA-form tour (`projects/reactome-gsa-form/src/lib/tour/`, `?gsa-tour=`) working; if a guided tour is chosen, reuse its lazy loading

### 1g — `/ContentService/` and `/AnalysisService/` root (US2) — blocked on decision 3

- [ ] T075 [US2] E2E (record failing first): a full page load of `/ContentService/` and `/AnalysisService/` shows the site header and this site's API page, no legacy menu, no `/gsa/home` link
- [ ] T076 [US2] Route the bare roots to `SwaggerPageComponent` in `proxy.conf.js:88` and `deploy/nginx/common/routes.conf` while every API path under them still reaches the service; keep `external: true` / `target="_blank"` in nav options and `CT/tools/index.mdx:27,32` only if decided; rebuild the nginx image and confirm API calls still work (`/ContentService/data/database/version`)

### `/gsa` destination (US2) — blocked on decision 4

- [ ] T077 [US2] Point `/gsa` and `/gsa/home` at the decided target: redirect in `WA/src/app/app.routes.ts` and content links in `CT/about/news/295-v97-released.mdx`, `291-v96-released.mdx`; remove them from `check-links.ts` exceptions; confirm `check:links` = 0 exceptions for these

### Wave 4 close-out

- [ ] T078 Full gate; PR; **adversarial review** (nginx change reviewed for any path it newly captures or drops; colour contrast measured; tour a11y); merge; confirm on main
- [ ] T079 Deploy (`npm run build:beta`; `docker compose build nginx && docker compose up -d nginx` if routes.conf changed), confirm `/health`, verify each decided item on beta by visible outcome
- [ ] T080 Update `CURATOR-REPORT.md`, `RELEASE-TESTING.md`, tracker

---

## Phase 7: Wave 5 — infrastructure, another team, or more information (rank 4–5)

- [ ] T081 [US1] **Blocked on decision 5** (how beta shows ReactomeGSA results): implement the chosen option — point beta's GSA at a server beta reads (`projects/reactome-gsa-form/src/lib/config/gsa-config.ts:12`), fall back to reactome.org for GSA tokens, or link out; test red first; verify a Camera run on MelanomaRNA-seq shows results on beta
- [ ] T082 [US1] Classify 3b report email as `NOT-OURS` in the tracker, owner ReactomeGSA backend, with the evidence (this site has no mailer; #237/#242 hardened our side); draft a short note for that team for the user to send
- [ ] T083 [US4] Classify 1d as `NEEDS-INFO` in the tracker: all 244 user-guide media are local; draft the question for the curator (which page, which image; were they on reactome.org/beta?)
- [ ] T084 [US5] **Blocked on decision 6** (overview: keep Reacfoam, offer both, restore Fireworks): record `NEEDS-DECISION` with the history (Fireworks removed in `4d53f23`, closes #90); no code until decided

---

## Phase 8: Polish & reply

- [ ] T085 Re-run every quickstart check on beta in one pass against the final bundle; any regression reopens its item
- [ ] T086 Confirm every tracker entry is in a terminal state (`FIXED` with evidence, `NOT-OURS` with owner, `NEEDS-INFO`, or `NEEDS-DECISION` with the question) — FR-023
- [ ] T087 Update `specs/008-curator-email-fixes/checklists/requirements.md` and mark completed tasks here
- [ ] T088 Draft the reply to the curator from the tracker (per item: what was wrong, what changed, how to see it on beta; items not fixed and why), for the user to review and send — not sent by Claude
- [ ] T089 Clean up: delete the scratchpad screenshots no longer needed, delete merged branches, confirm the working tree is clean

---

## Dependencies & execution order

- **Setup (T001–T003)** → Wave 1.
- **Waves run in order**, each merged, deployed and verified before the next starts (the
  plan's rule). Within a wave, items are independent unless noted.
- **Within an item**: red test → fix → green → (later) beta verification.
- Cross-item dependencies:
  - T035/T036 (link check) before T040–T045 and before T056–T057, T077.
  - T063 (shared hover signal) before T071 (2e).
  - T043/T056 leave `/gsa` for T077.
  - Wave 4 tasks wait on T069 and the named decision; Wave 5 T081/T084 on decisions 5/6.
- Stories are independent of one another; US5 depends on nothing and blocks nothing.

## Parallel opportunities

- **Wave 1**: the red tests T004, T007, T011, T014, T018, T021, T023 touch different files
  and can be written together; fixes 1a/1b/1f (content) run alongside 2c/3c/2f/3b (code).
  Beta verifications T030–T033 run together.
- **Wave 2**: T037–T039 (3a) alongside T040–T042 and T045 (content), after T035/T036.
- **Wave 3**: 1c (T050–T054), 1e (T055–T057), 2g (T058–T061) and 2d (T062–T064) are four
  independent streams.
- **Wave 4**: each decided item is independent once answered.

```text
# Wave 1 red tests, together:
T004 e2e/content-pages.spec.ts (1a)      T007 e2e/downloads.spec.ts (1b)
T011 page.component / content e2e (1f)   T014 PB/ehld/ehld-svg.spec.ts (2c)
T018 summary.service.spec.ts (3c)        T021 e2e/detail-contents.spec.ts (2f)
T023 analysis load error unit test (3b)
```

## Implementation strategy

- **MVP = Wave 1**: seven rank-1 items across US1, US2, US3 and US4, each certain and
  cheap to verify — the curator sees visible progress on every story except the deferred
  overview.
- **Incremental**: each wave is one PR, adversarially reviewed, merged, deployed, verified,
  and written into the tracker before the next begins, so a partial stop still leaves every
  landed item `FIXED` with evidence.
- **Clean stop point**: after Wave 3 every item not waiting on the user is done; Waves 4–5
  proceed as decisions arrive.
