# Quickstart: showing each story works

Run from the repository root. Host-specific settings (database addresses, credentials, store locations) come from the deployment's environment, never from this repository.

## Story 1: the split is recorded

- [contracts/operation-homes.md](contracts/operation-homes.md) lists 98 ContentService and 39 AnalysisService operations, each with one home.
- Check it against a freshly fetched API description: every published method and path appears exactly once.

## Story 2: the Java library service

1. **Build and start it:** `docker compose build java-library`, then `docker compose up -d --no-deps java-library`. Its health endpoint reports the pinned commits.
2. **Parity against the running server:** run the parity harness for each class (PSICQUIC, overlay tokens, uploads into a throwaway store, SBML, SBGN, event PDF). Expected: zero unexplained differences. PDFs are compared after normalisation, as declared.
3. **Transparency:** run the same requests through node and directly. Expected: identical status, headers and bytes.
4. **Cut over one address group:**
   - add its nginx location and dev-proxy pattern;
   - run `npx vitest run deploy/nginx projects/website-angular/src/scripts/proxy-order.spec.ts`;
   - run `deploy/nginx/test-config.sh`;
   - deploy.
   - Then on the deployed site, open the page that uses it: the interactor overlay for PSICQUIC, a shared overlay link for a token, the export buttons for SBML, SBGN and PDF. Check that the request is answered through node.
5. **Failure:** stop the Java service. Every Java-homed address answers 503 in ContentService's envelope, and node's own pages are unaffected. Start it again.
6. **Roll back:** delete the location. The address is answered by Tomcat again.

## Story 3: AnalysisService

1. **Build and start it** from its pinned commit, with the release's analysis data mounted read-only and its own token volume.
2. **Replay the analysis corpus** against the old and new services:
   - the 11 example submissions;
   - projection, interactors and species comparison;
   - token follow-ups and downloads.
   - Expected: identical results with the token removed, identical downloads, and identical normalised report PDFs.
3. **Old tokens:** read a sample of at least 100 existing tokens through the new service from a read-only copy. Expected: identical.
4. **Cut over by nginx, then on the deployed site:** run an analysis from the Pathway Browser, reopen it by token, download the CSV and the report.

## Story 4: Tomcat off

1. Every one of the nine other webapps has a recorded decision.
2. With every address routed to its new home, stop Tomcat. Run the end-to-end suite, the release checks, and a call to every published operation. Expected: all pass.
3. Reverse one address to Tomcat, start Tomcat, and check that only that address moves.

## Story 5: analysis result types

Run `npx vitest run tools/analysis-types` (every recorded answer against the site's types; `node tools/analysis-types/record.ts` records the extra kinds again, three analyses, one at a time). Expected: it passes. Remove a field the site reads from one result: the check fails.
