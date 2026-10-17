# Working in this repository

Day-to-day guidance for anyone, human or agent, changing this repository. The
principles are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md);
where this file and the constitution disagree, the constitution wins.

## Specs first: use Spec Kit

Work that is feature-sized goes through Spec Kit before any code, and the specs
live in [`specs/`](specs/) so the team can read what was decided and what is done.

- **Feature-sized** means: a new feature, a new family of endpoints, a change to
  how services are built or run, or anything that will take more than one pull
  request.
- **The sequence** is `/speckit-specify` → `/speckit-plan` → `/speckit-tasks`, then
  implementation task by task (`/speckit-implement`, or by hand).
- **Keep `tasks.md` current.** The pull request that completes a task ticks it
  and adds the PR number, in the same pull request rather than afterwards.
  Continuing a family that already has a spec (another ContentService endpoint,
  say) means adding or ticking a task in that spec, not working off-spec.
- **A single-PR fix** needs no new spec, but its description names the spec it
  belongs to, if any.

Why: the porting of ContentService endpoints to node ran for weeks against a
research note alone. What was done and why lived in pull requests and one
person's notes, not anywhere the team could read in one place.

## Before pushing

`scripts/preflight.sh` runs every gate CI runs (types, lint and dead-code
ratchets, formatting, unit and end-to-end tests, builds), and the pre-push hook
runs it. Never skip it with `--no-verify`: a skipped hook is how a formatting
failure reached CI.

- **Prove a test fails** before trusting it passes: undo the fix and watch it
  fail, or mutate the code and watch the test catch it (constitution III).
- **Lint and dead-code counts** are ratcheted: they may go down, never up.

## The node content service (`tools/content-node`)

- **What it does:** it answers ContentService endpoints, one by one, in place of
  the Java service. Each ported endpoint must be **byte-identical** to Java's
  answer for the same request, errors included, compared live before it is
  routed.
- **Where a request goes** is decided in two hand-kept tables that must agree:
  nginx (`deploy/nginx/common/routes-core.conf`) and the dev proxy
  (`proxy.conf.js`). `deploy/nginx/routes.spec.ts` checks they agree, and every
  node route takes a trailing slash, as Spring's routes do.
- **No fallback:** a route node answers is never answered by Java as a fallback.
  Endpoints that stay in Java are listed in `specs/010-java-services`.

## nginx

- **Quote a location regex** that contains `;` or `{`: nginx otherwise reads the
  `;` as the end of the directive and refuses the whole configuration.
- **`deploy/nginx/test-config.sh`** runs `nginx -t` on the image for every
  deployment. CI runs it; run it yourself after touching anything under
  `deploy/nginx`.

## This repository is public

Nothing internal goes in it: no host names, server paths, credentials, incident
detail or internal release process — in code, comments, commit messages or pull
request descriptions.
