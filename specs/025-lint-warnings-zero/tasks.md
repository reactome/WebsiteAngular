# Tasks: No lint warnings

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Each task is one pull request. The pull request that completes a task ticks it
here and adds its number. Counts are as measured on 13 Nov 2026.

## Phase 1: The small rules (User Story 1, P1)

- [x] T001 [US1] The small rules, cleared and promoted to `error` in
      `eslint.config.js`: `@angular-eslint/template/button-has-type` (10),
      `@angular-eslint/no-input-rename` (7), `@angular-eslint/no-output-native`
      (6), `@typescript-eslint/no-unused-expressions` (6), `no-useless-escape` (2),
      `@typescript-eslint/ban-ts-comment` (1), `@typescript-eslint/no-empty-object-type`
      (1), `no-empty-pattern` (1), `prefer-const` (1), and four of the five
      `no-useless-assignment`. Seven rules already at zero but still at `warn` were
      promoted too (`no-require-imports`, `use-lifecycle-interface`,
      `no-wrapper-object-types`, `no-extra-non-null-assertion`, `no-output-rename`,
      `no-unused-vars`, `template/prefer-control-flow`). Renamed inputs take their
      public names, so no binding changed; the outputs named after DOM events become
      `pressed` (the download button) and `closed` (the analysis forms). 879 → 838.
- [x] T001a [US1] The last `no-useless-assignment`: a bug (see below), fixed with
      a test (`router-url-state.service.spec.ts`), then the rule promoted (#956).
      838 → 835: the dropped line was also an unsafe assignment, and the `tab`
      translation's `!` became `?? null` (an unknown code had set `undefined`).
- [x] T001b [US1] `@typescript-eslint/no-namespace` (12): the model namespaces
      (`Analysis`, `Search`, `Graph` and others) become modules, then the rule is
      promoted. Two unused ones in the GSA form's `dataset-library.ts` went in T001.
      Each model file is now the module its names live in, imported whole as the
      namespace was named, so every `Analysis.Result` reads as before;
      `Search.Icon.Entry` and `.Result` became `Search.IconEntry` and
      `Search.IconResult`. The table store's `Ranges` and `Cells` became modules
      beside it (`ranges.ts`, `cells.ts`, with the row and cell accessors they
      share in `dataset.ts`), moved token for token but for two locals renamed so
      as not to shadow the module's own `origin` and `limits`. The two private ones
      (`SvgDecoration`, the Reacfoam's `Layout`) became plain interfaces. The
      contract's one-description check names a declaration by the name its module
      is imported under, so `Analysis.Result` is still protected as such; the
      recorded-answer check imports such modules whole. 835 → 822 (main measured
      834: one warning of slack). Dead code 104 → 100 (main measured 102):
      `Layout` is no longer an unused export, and the store's `LocatedValue` is
      now imported (#962).

## Phase 2: Values typed "anything" (User Story 2, P2)

The five `no-unsafe-*` rules and `no-explicit-any`, area by area.

- [x] T002 [US2] `projects/reactome-table` (19). `CellInfo.value` is a
      string, as the table's cells are; the spec imports vitest's functions rather
      than relying on its globals; `width` and `height` take any table. The web
      component's JSON attributes were never parsed (a bug, below): the table's
      `table` and `userSettings` inputs now parse a string through a type guard,
      and `safeInput` is gone. Its two non-null assertions are T015's. 822 → 803
      (#963).
- [x] T003 [US2] `e2e` (16; its 5 non-null assertions with it). Request bodies
      and JSON answers are read through guards in `e2e/support/json.ts`
      (`isRecord`, `isArray`, `bodyOf`), the diagram's style and interactivity
      handler through guards defined inside the page function, and a missing box
      is reported (`box?.width`, or an error naming it) rather than asserted
      away. Three unchecked casts went with them (the GSA submission's
      parameters, the method list and the captured GSA reads). No gate type-checks `e2e/`; checked by hand against
      main with the root tsconfig, it has no new error and one fewer. 803 → 782
      (#964).
- [x] T004 [US2] `projects/reactome-gsa-form` (100), split in three by what the
      types flow through: the models, services, utilities and components first,
      then the state.
  - [x] T004a The models, services, utilities and components (42), and 22 of the
        state's with them: a parameter's value is `ParameterValue` (text, a
        number or a boolean, as `parserFor` reads it), a request's parameters
        are text, a summary's default parameters are text as the service sends
        them (measured in the recording), and the service's methods are read as
        the state's `Method` (the model's `Method`, `MethodParameter` and
        `ParameterJSON` were never constructed, and are gone). The effects read a
        default through `readDefault`, which reads one as `parserFor` did, an
        absent one included. Four bugs (below). 782 → 718; dead code 100 → 99
        (#965).
  - [x] T004b The state, all of it (36): T004c folded in, its warnings being
        the same few lines in every folder. A failure action carries the error
        it was given as `unknown`, what `catchError` gives; only two places read
        one, and they narrow it: the analysis effect retries a 503 only from an
        `HttpErrorResponse`, and the analysis reducer shows an
        `HttpErrorResponse`'s reason and any other error's message, as before
        (`analysis.reducer.spec.ts`, passing on the old reducer and the new). A
        load's parameters are `LoadParameter`s, text, as every caller sends.
        `projects/reactome-gsa-form` now lints clean. 718 → 682 (#968).
  - [x] T004c Folded into T004b.
- [x] T005 [US2] `projects/website-angular`, all but the search page and
      `src/utils` (78, counted on 15 Nov: the thirds split by folder as search
      70, `src/utils` 80 and the rest 78). The specs import vitest's functions
      rather than relying on its globals (`link.spec.ts`); the detail page's
      stand-ins take the Pathway Browser's own types (`_refEntities` is a resource
      with nothing to load, `currentResource` a `ResourceAndType`, the palette,
      view mode and resource filter their `UrlStateService` types) and read an
      external reference's fields through `fieldByName`; the schema page reads its
      route through `paramMap`; the page holds a `PageContent`; the Swagger UI
      bundle's global is declared with the options the page gives it; the article
      index is typed as `generate-index.ts` writes it, and read so; a site-search
      hit is its page's item, found by the identifier MiniSearch gives back
      (`site-search.service.spec.ts`, passing on the old service and the new,
      failing with the empty-body fallback removed); the health route's answer is
      read through a guard in `serve-prod.spec.ts`. No gate type-checks the
      scripts and specs here; checked by hand against main with the root
      tsconfig, the files touched have no new error and 19 fewer. 682 → 604
      (#969).
- [x] T006 [US2] `projects/website-angular`, the search page (70). Its specs
      import vitest's functions; the page reads its query parameters through
      `paramValues` (one, several or none, as the router gives them; a `q` or
      `page` given twice reads its first value, where a repeated `q` put a list
      in the query before), and a failed search's 404 through `saysNoEntries`; a
      site page's address is read as `pageUrl` where the entry has one; the
      answer panel reads a 401's site key and verify address as text;
      `SearchFilters` is a type rather than an interface, so `Object.entries`
      reads its values as lists. New tests, each passing on the old code and the
      new and failing on a planted fault: a site page's link and its fallback, a
      failed search's 404 and the other failures (`search.component.spec.ts`),
      and a 401's challenge and its refusals (`answer.service.spec.ts`). Checked
      by hand against main with the root tsconfig, the files touched have no new
      error and 33 fewer. 604 → 534 (#970).
- [x] T007 [US2] `projects/website-angular`, `src/utils` (80): the HTML
      passes' `replace` callbacks take their groups as text (an optional group
      as `string | undefined`), and the navigation menus are read from
      `nav-options.json` as `unknown`: a field as text where it is text (empty
      otherwise), `external` by its truth, an icon only where it is text. On the
      real file the menus are as before (compared once, old mapper against new);
      `nav-options-mapper.spec.ts` (new) passes on both, and fails with
      `external` ignored. `projects/website-angular` now has no "anything"
      warnings. 534 → 454 (#971).
- T008–T013 [US2] `projects/pathway-browser`, by feature folder: 309 on
  15 Nov, split into six of about 50 (folders under `src/app`).
  - [x] T008 `details/common` and the small folders: `citation`, `model`,
        `reacfoam`, `render`, `shared/logger`,
        `utils/expandable-virtual-scroll` (47). Types only, no runtime change:
        the byline spec imports vitest's functions; the citation dialog's data
        is injected as a `Citation`; a search's `Params` is a type rather than
        an interface extending `Record<string, any>`, so it is still sent as
        the request's parameters; the Reacfoam's `throttle` takes `unknown[]`;
        a node's background image is read as `unknown`; the logger's input is
        `unknown`; the resize directive's element is an `HTMLElement`. 454 →
        407 (#972).
  - [x] T009 `details/tabs` (41). The description tab's templates are
        `TemplateRef<unknown>`, the two optional ones held as possibly
        undefined rather than cast; the animated-download dialog is opened
        typed with its result, `DownloadOptions`; the PDBe Molstar global is
        declared with the one method used. The three analysis tables (results,
        found, not found) read a column's value through `valueAtPath` and sort
        through `sortRows` (`result-tab/sort-rows.ts`), Material's own
        `sortData` for a key that may be missing, which its accessor's type
        cannot return. No order moved: compared once, old accessors through
        Material's `sortData` against the new on generated rows (zeros,
        missing values, `NaN`, lists, both directions and none);
        `sort-rows.spec.ts` (new) passes, and fails on each planted fault (a
        missing key sorted last, numbers compared as text, no direction
        sorting, 0 dropped, the path walk broken, the found table's 0 kept or
        its lists' length dropped). 407 → 366 (#975).
  - [x] T010 `diagram`, with `diagram/entity-popup` (63). What the diagram
        keeps on its elements is read through `element-data.ts`: text as
        text, a number as a number, an entity's leaves where they are a list,
        an interactor occurrence's accessions, a sub-pathway's edges where
        they are a collection, and the bound `Style` by `instanceof`; each
        reads anything else as absent, where the old reads threw or passed it
        on. Node event handlers take cytoscape's `EventObjectNode`, `add` and
        `remove` an event on one element; the popup checks a click's target
        is a `Node`. One thing moves: selecting an entity with no stable id
        (one with no counterpart in an inferred species' diagram) sets the
        selection to `null` where it set `undefined`; both mean none.
        `element-data.spec.ts` (new) passes, and fails on each planted
        fault. 366 → 303 (#976).
  - [x] T011 `interactors` (52). What an interactor badge keeps on its
        element is read through `element-data.ts`: its interactors as the
        entries with an accession (`drawnInteractors`), its entity where it is
        a node, a list where it is one, and its data copied as an object; the
        badge counts, the export and the threshold read the same way, so their
        casts went too. The custom-resource dialog's form is typed. Four things
        move: sharing a file by link sends the file (a bug, below); an entity
        with no accession no longer adds an empty identifier to the request;
        a badge with no list or no entity draws and removes nothing, where it
        threw; entries with no accession are left out, where they threw or
        were passed on (none are sent so). `interactor-drawing.spec.ts` and
        `upload-form.spec.ts` (new) and `element-data.spec.ts` pass, and fail
        on the old service and on each planted fault. 303 → 251 (#977).
  - [ ] T012 `pipes` (50).
  - [ ] T013 `services`, `event-hierarchy`, `viewport` and `deltasignal` (56).
        `deltasignal` (5) is another session's work at present: its warnings
        wait for that session, or are cleared with it.
- [ ] T014 [US2] Promote `no-explicit-any` and the five `no-unsafe-*` rules to
      `error` (their counts are zero).

## Phase 3: Asserted values (User Story 3, P3)

- [ ] T015 [US3] `no-non-null-assertion` outside the Pathway Browser (8).
- [ ] T016–T017 [US3] `no-non-null-assertion` in the Pathway Browser (138), in
      two halves; the second promotes the rule to `error`.

## Phase 4: Done

- [ ] T018 Confirm `lint-baseline.json` has no warned rules left, and every
      rule warned on 13 Nov is an error; list the silenced lines (SC-004) and the
      bugs found (SC-005) here.

## Bugs found on the way

- **A legacy query parameter's value is thrown away**
  (`projects/pathway-browser/src/app/services/router-url-state.service.ts`, the
  `otherTransform` line). A parameter given under an old name (`?DTAB=…` for
  `tab`, `?TOOL=AT` for `analysisTab`) is translated, and the translation is
  then dropped, so nothing is set. `#TOOL=AT` is rewritten to `analysisTab`
  before this and worked; `#…&DTAB=…` is passed on under its old name, so it was
  dropped too. Fixed in T001a: the translation is set.
- **Every excerpt ends in "...", cut or not**
  (`projects/website-angular/src/utils/truncateHtml.ts`): the ellipsis is added
  unconditionally; the check meant to add it only when the text was cut did
  nothing (`result;`). The dead check went in T001; the ellipsis is unchanged,
  as fixing it changes what readers see, and waits for a decision.
- **The table web component drew nothing from its documented use**
  (`projects/reactome-table/src/lib/utils/web-component-utils.ts`, `safeInput`).
  Its attributes are strings, so its demo page sets `table` as JSON. `safeInput`
  was to parse it, but tested the input itself, a signal since the inputs became
  signals, so it never did: the store was given the string, threw
  (`entries is not a function`), and the table was empty. Fixed in T002: the
  inputs parse a string, through a type guard, with a spec seen failing against
  the old pass-through and against each guard loosened; the built web component,
  loaded as its demo page does, now shows the demo's cells, and threw before.
- **A failed GSA request could show no message at all**
  (`projects/reactome-gsa-form/src/lib/utilities/utils.ts`, `extractErrorMessage`).
  It read the body as text whenever it had no `detail`: a request that never
  arrived (its body the browser's `ProgressEvent`), an empty body, or text
  starting with `{` that was not JSON each threw a `TypeError` or `SyntaxError`
  inside the requests' `catchError`, so the snack bar never opened and the
  failure became that error. Fixed in T004a, with `utils.spec.ts` (failing on
  each of the three before).
- **Clicking a local-data card threw**
  (`…/local-data/local-data.component.ts`, `onFileSelected`). The card's click is
  bound to the file handler too, and read `event.target.files[0]` from an
  element with no files. Only the console showed it. Fixed in T004a
  (`chosenFile`, `local-data.spec.ts`, failing before).
- **Importing with an empty field threw**
  (`…/external-data/external-data.component.ts`, `loadData`):
  `param.value.toString()` on an absent value. The Import button did nothing,
  and still sends nothing while a field is empty, now without the error
  (`loadParameters`, `external-data.spec.ts`, failing before).
- **A parameter type named like an object's own property** (`toString`) was read
  by `Object.prototype`'s function instead of as text (`parserFor`). Not one the
  service sends; fixed with `Object.hasOwn` in T004a, its case seen failing with
  `in`.
- **An expression of 0 sorts as missing** in the analysis's found and
  not-found tables (`found-table`, `not-found-table`, their sort keys): any
  falsy value is no key, so a 0 sorts before every negative value ascending
  and after them descending. The results table sorts 0 as a number. Kept in
  T009, as fixing it changes what readers see, and waits for a decision.
- **A custom resource's file, shared by link, was sent as "[object Object]"**
  (`…/interactors/custom-interactor-dialog`, `prepareFormData`). The file field
  holds the file input's `FileInput`, not a file, and it was appended to the
  upload as it was; `FormData` turns anything but a file into text, so with
  "share by link" ticked the service was sent the text "[object Object]" in
  place of the reader's file. (Read in the page, the default, the file was read
  right.) Fixed in T011: the chosen file is sent (`upload-form.ts`,
  `upload-form.spec.ts`, failing with the holder appended).

## Silenced lines

1. `projects/pathway-browser/src/app/services/analysis.service.ts`,
   `noData`: `@ts-expect-error`, because `@types/chroma-js` leaves out
   `Scale.nodata`, which chroma-js has. (It was there before; T001 gave it its
   reason.)
