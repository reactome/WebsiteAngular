# Implementation Plan: Curator email review, 25 September

**Branch**: `008-curator-email-fixes` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-curator-email-fixes/spec.md`

## Summary

Seventeen curator-reported problems, researched to root cause in [research.md](./research.md)
and re-verified. They resolve into three kinds:

- **Defects with a certain cause and a small fix** — most of them. Several are wider than
  reported: no event on the site has ever shown its computationally predicted
  orthologues (2g); 73 internal links are broken, not the five reported (1e, site-wide);
  the analysis-summary fix shipped a week ago never ran on the path readers take (3c).
- **Changes that need the user's decision** — new top-bar UI (2a), a highlight colour
  (2e), what `/ContentService/` returns to outside developers (1g), a destination for
  `/gsa` (1e), how beta should show ReactomeGSA results (3b), the overview view (2b).
- **Not this site's** — report email is sent by ReactomeGSA (3b); one item could not be
  reproduced and needs the curator's detail (1d).

Work is ordered **by certainty and ease of verification first**, as the user asked, so a
verified base lands before anything that waits on a decision.

## Technical Context

**Language/Version**: TypeScript 5.9 on Angular 21 (zoneless, signals, `strictTemplates`);
Node 24 for build scripts and services.

**Primary Dependencies**: Angular Material; cytoscape (pathway diagrams); angular-split
(panels); the content pipeline (`.mdx` → `stage:content` → `content-dist`); nginx and
compose services (`content-node`, `render`, `mcp`).

**Storage**: Content as `.mdx` and static assets in the repository; graph data served by
ContentService; analysis results by the Analysis Service.

**Testing**: vitest (unit), Playwright (e2e with recorded fixtures; `E2E_RECORD=1` against
a live backend), and direct verification on beta.

**Target Platform**: beta.reactome.org — built with `npm run build:beta`.

**Project Type**: Web application (website + pathway browser in one Angular workspace).

**Performance Goals**: No regression. The EHLD parse change and the orthologue list are
the only additions on a hot path; both are measured before and after.

**Constraints**: Public repository — no curator names, email content or internal process.
Ratchets: lint ≤ 652 warnings, dead code ≤ 145. Beta shares a database with the Java
service; nothing here writes to it.

**Scale/Scope**: 17 items plus 73 related broken links; roughly 60 files, mostly content.

## Constitution Check

_Gate: must pass before Phase 0; re-checked after Phase 1._

| Principle                         | How this plan meets it                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I. Verify the instrument**      | Every item's verification names the _visible outcome_, never an HTTP status: the SPA answers 200 for missing pages, which is how three of these problems stayed hidden. Research re-verified each agent's claim independently. |
| **II. Measure in the thing**      | Done means observed on beta. 2c was proven on beta before being planned; 3c was reproduced on beta; 1d was **not** reproducible and is reported as such rather than "fixed".                                                   |
| **III. Prove a test fails first** | Each code fix gets a test shown failing against the current code. Content fixes are covered by the link-integrity check, which is itself shown catching a known-broken link.                                                   |
| **IV. Stable identifiers**        | Orthologous-event links (2g) and spotlight imports (1c) link by stable id.                                                                                                                                                     |
| **V. Comments carry the failure** | Each fix records what went wrong without it — notably 3c, where the previous fix is named as the thing that did not work.                                                                                                      |
| **Scope stays as asked**          | The brief _asks_ for related instances site-wide, so the 73 links and the three broken news images are in scope. EMF logo files, Reacfoam hover and reverse-direction hover are **raised, not built**.                         |
| **Curator documents**             | `CURATOR-REPORT.md` and `RELEASE-TESTING.md` updated as items land.                                                                                                                                                            |

**Gate: PASS.** No violation requires justification.

## Execution order

Ordered by rank (see research.md). Each wave is a pull request — reviewed adversarially
before merging, per the user's standing instruction — then deployed to beta and verified
there by its visible outcome before the next begins.

### Wave 1 — certain and easy to verify (rank 1)

| Item      | Change                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 1a        | `title: Digital Preservation`; mend the split "repository" link                                      |
| 1b        | Rename the two `.png.png` logo files; add `download` to all 16 anchors; delete dead `about/logo.mdx` |
| 1f        | Per-release inference chart via `{release}`; curator guide and release documentation to V97          |
| 2c        | Parse EHLDs as XML (`DOMParser`), not HTML; surface parse errors                                     |
| 3c        | Service records which analysis it holds; component clears on mismatch; close button                  |
| 2f        | Render GO biological process in the overview                                                         |
| 3b (part) | Stop discarding an unloadable analysis token silently — tell the reader                              |

### Wave 2 — certain, one small judgement (rank 1–2)

| Item         | Change                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 3a           | Example buttons: two columns only when wide enough; labels wrap; full-name tooltips. Same for species names |
| Site-wide    | Correct the 73 broken internal links in content                                                             |
| 1d (related) | Fix the three news items with page URLs in image tags                                                       |

### Wave 3 — certain cause, contained design (rank 2)

| Item | Change                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 1c   | Delete 40 duplicates; import 294 and 296 verbatim; reactome.org's intro; index generator fails on duplicates |
| 1e   | Fix V97 and V96 news links; redirects for legacy paths with a clear new home                                 |
| 2g   | Orthologous-events section keyed on `orthologousEvent`; "Computationally inferred" line                      |
| 2d   | Shared hierarchy-hover signal; EHLD highlights the hovered region                                            |

### Wave 4 — needs the user's decision (rank 3)

| Item | Decision                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 2e   | Yellow as a dedicated highlight, or change the global hover colour                                          |
| 2a   | Tour: reactome.org's video, or a guided tour. Layout: three panel toggles. Placement in an EBI-designed bar |
| 1g   | Serve this site's API page at `/ContentService/` and `/AnalysisService/` instead of Tomcat's legacy page    |
| 1e   | Where `/gsa` should go                                                                                      |

### Wave 5 — infrastructure, another team, or more information (rank 4–5)

| Item | Status                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 3b   | How beta shows ReactomeGSA results (point GSA at a server beta reads, fall back to reactome.org, or link out) — decision |
| 3b   | Report email — **not ours**; ReactomeGSA backend                                                                         |
| 1d   | Could not reproduce — ask the curator which page and image                                                               |
| 2b   | Overview node view — **deferred** for the user's decision                                                                |

### Decisions needed from the user, collected

1. **2e** — yellow hierarchy-hover highlight: a dedicated highlight, or change hover everywhere?
2. **2a** — tour as reactome.org's video, or a guided tour? Layout toggles in the top bar?
3. **1g** — serve this site's API page at the `/ContentService/` root?
4. **1e** — where should `/gsa` lead?
5. **3b** — how should beta show ReactomeGSA results?
6. **2b** — overview node view: keep Reacfoam, offer both, or restore Fireworks?

## Project Structure

### Documentation (this feature)

```text
specs/008-curator-email-fixes/
├── spec.md
├── plan.md              # this file
├── research.md          # root causes, decisions, verification, ranks
├── data-model.md        # the curator-item record and its states
├── quickstart.md        # how to verify every item on beta
├── contracts/
│   └── ui-contract.md   # the visible behaviour each fix promises
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source code (touched)

```text
projects/website-angular/
├── content/
│   ├── about/digital-preservation.mdx, about/logo.mdx (deleted)
│   ├── about/news/{291,295,286,288,273,…}.mdx
│   ├── content/reactome-research-spotlight/  (40 deleted, 2 imported)
│   └── documentation/{inferred-events,curator-guide,release-documentation}.mdx
├── public/uploads/about/logo/  (two renames)
├── src/app/about/logo-page/
├── src/app/app.routes.ts       (legacy redirects)
├── src/app/article-page/        (spotlight intro)
└── src/scripts/generate-index.ts (duplicate guard)

projects/pathway-browser/src/app/
├── ehld/ehld.component.ts                     (2c, 2d)
├── analysis-summary/                          (3c)
├── services/analysis.service.ts               (3b silent drop)
├── details/tabs/description-tab/              (2f, 2g)
├── event-hierarchy/                           (2d, 2e hover signal)
├── diagram/diagram.component.ts               (2e)
└── viewport/analysis-form/qualitative-analysis/ (3a)
```

**Structure decision**: No new projects. Changes sit in the files that own each behaviour.

## Post-design Constitution re-check

Re-checked after Phase 1: **PASS**. One design choice was tightened against principle I —
the link-integrity check resolves a link against a content file or route, never by
fetching it, because a fetch of a missing page returns 200.

## Complexity Tracking

No constitution violations. One addition beyond the reported items is justified in
place: legacy-path redirects (1e) are the conventional answer to moved URLs and fix many
of the 73 links at their source, but content is corrected too, so no link depends on a
redirect.
