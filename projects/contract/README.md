# The API contract

The answers the content service writes and the site reads, one definition each
(spec 016). The service's writers and the site's readers import the same type,
so a field renamed or retyped here fails the build on both sides.

## Rules

- **Types only.** Nothing here may emit code: no enum, namespace, constant or
  class. The service runs its `.ts` under Node with type stripping and no build
  (spec 013), and its image holds only `tools/content-node/` and
  `tools/package.json`. A value here would pass the checks locally and fail in
  the image. `contract.spec.ts` holds this, and lint holds the contract to the
  rules it holds `tools/` to.
- **Imports.** A contract module imports only other contract modules, with
  `import type` and a relative path ending in `.ts`. Readers import it the
  same way: the service as `../../projects/contract/<module>.ts`, the site's
  model files with `export type { … } from '../../../contract/<module>.ts'`.
- **The type follows what is written.** Where a type and the recorded answers
  disagree, the type changes, measured on the recorded answers
  (`tools/api-types`); the service keeps answering exactly as Java does.
- **Named type arguments.** Every type argument in an answer type is a named
  type, so the generated description's names are stable.
- **Writer helpers stay with the service.** `JsonWritten`, `compact`,
  `nonEmptyJson` and `JsonMember` remain in `tools/content-node/answers.ts`
  and take these types as arguments.
