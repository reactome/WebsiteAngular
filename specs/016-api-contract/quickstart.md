# Quickstart: validating the contract

Prerequisites: Node 24 on the PATH, with the repository's dependencies installed. Nothing here touches the graph database or any Reactome service.

## 1. Both sides fail on one change (US1)

1. Rename a field in a contract type, for example `count` in `FacetCount` in `projects/contract/search.ts`.
2. Run `npx tsc -p tools/tsconfig.json --noEmit` and `npm run check:types`.
3. **Expected:** both fail. The service names its writer (`tools/content-node/search-core.ts`), and the site names its reader.
4. Undo the rename; both pass.

## 2. The contract stays types only (R1)

1. Add `export const probe = 1;` to a contract module.
2. Run the contract's boundary spec.
3. **Expected:** it fails, naming the file.
4. Change one `import type … from '../../projects/…'` in `tools/content-node` to a plain `import`.
5. **Expected:** the same spec fails.

## 3. The search entry matches the recordings (US2)

1. Run `npx vitest run tools/api-types`.
2. **Expected:**
   - the search routes' known problems in `tools/api-types/known-problems.json` are at zero, or each remaining one is recorded with its reason;
   - the total is no higher than before.
3. Run the schema check over the same answers.
4. **Expected:** every recorded entry matches exactly one kind.
5. Remove one kind from the union and run the schema check again.
6. **Expected:** that kind's entries fail.
7. Make two kinds overlap (widen one kind's `type`) and run it again.
8. **Expected:** the entries both match fail, as matching two kinds.

## 4. Nothing on the wire changed (FR-005)

1. Deploy the service, then run the parity comparison and the search part of the e2e suite (`E2E_PORT=4330`).
2. **Expected:** every search answer is byte-identical to before. Each pull request records its before-and-after.

## 5. The description is current (US4)

1. Change a contract field without regenerating `projects/contract/openapi.json`.
2. **Expected:** the up-to-date spec fails.
3. Regenerate with the script.
4. **Expected:**
   - the spec passes;
   - the diff shows the field;
   - the search entry appears as a `oneOf` of its six kinds;
   - a route not yet in the contract is marked `x-contract: "not yet"`.
