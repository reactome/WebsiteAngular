# Decisions behind how the site is built and served

Each entry: what was decided, why, what was rejected, and the measurement that
settled it. Dates are when the figure was read off this host or CI.

These are the choices that do not belong to any one feature — the toolchain, the
web server in front of beta, and two behaviours a curator reported.

---

## D1. nginx serves beta; Apache is stopped and disabled

**Decision**: nginx runs as the `reactome-nginx` container on ports 80 and 443,
from `deploy/nginx/dev.conf`. Apache is `systemctl disable`d. Cut over 2026-09-17.

**Why**: The operational reason is connection handling. The security reason is
that the retired site's vhost was the default server and held the class of
problem open; nginx has no `mod_include`, so the class disappears rather than
being held shut by one `503`.

**Measured** (2026-09-17), connections to Tomcat after 40 concurrent requests:

    Apache:  76 CLOSE-WAIT vs 19 ESTABLISHED
    nginx:   48 ESTABLISHED, 0 CLOSE-WAIT, 2 TIME-WAIT

**Rejected**: leaving Apache and tuning it. The CLOSE-WAIT pile was the symptom
that prompted the work, but the configuration cruft was the reason to move.

---

## D2. Each upstream gets the keepalive its own backend allows

**Decision**: `keepalive_timeout` is set per upstream, from a measurement of that
backend, not copied.

**Why**: `proxy_http_version 1.1` with `Connection ""` only cures a CLOSE-WAIT
pile while the pool's idle timeout is **shorter** than the backend's. One comment
explaining Tomcat's 20s was pasted into all five upstreams, of which two are
Tomcat.

**Measured** (2026-09-17), by opening a keep-alive socket and timing the close:

    site (node/express)    6.0s   ->  4s
    chatbot (uvicorn)      5.0s   ->  4s
    deltasignal (julia)   >25s    -> 10s
    content, analysis     20.0s   -> 10s

The chatbot case was reported by the session working on `reactome_chatbot`;
checking the rest of the file found `site` had the same inversion, and that one
serves every page.

---

## D3. nginx reads its config from outside the git working tree

**Decision**: The running config lives in `/etc/nginx-reactome/`, root-owned, put
there by `~/nginx-deploy-config.sh`. Deploying is an explicit act.

**Why**: The cutover originally bind-mounted `deploy/nginx/dev.conf` straight from
the repository, so `git checkout` changed what the public-facing server would load
on its next reload or reboot. Nothing warned about it.

**Rejected**: discipline about which branch is checked out. That is not a control.

---

## D4. Node 24 and npm 11

**Decision**: `engines` requires `node >=24.0.0` and `npm >=11`; `.nvmrc`, all
workflows and both Dockerfiles agree.

**Why**: `engines` previously pinned `node: 22.x` and `npm: >=10 <11`, and that
pin was the reason a lockfile generated locally and one generated in CI could
never agree — npm 11 records optional platform packages npm 10 omits. Angular 21
declares `>=24.0.0` and 24 is Latest LTS.

**Measured** (2026-09-17): moving to 24 changed **no** dependency's version — 91
packages added, all optional platform binaries; 0 removed; 0 that lost a version.

---

## D5. `--legacy-peer-deps` is gone, because vitest moved

**Decision**: vitest is pinned at `4.1.11` and nothing installs with the flag.

**Why**: The flag was covering exactly one conflict, and it was ours: this repo
pinned `vitest` at `3.2.7` while `@angular/build` asks for `^4.0.8`.

**Measured** (2026-09-17): bumping vitest changed **13** packages, all inside
vitest's own tree. The unit suite needed no changes — 244 tests before, 244 after.

**Rejected, and worth recording because it was believed for a day**: that
`@analogjs/vitest-angular` was the blocker and removing the flag would drag 207
top-level version changes including React 18 → 19. Analog accepts
`^1 || ^2 || ^3 || ^4` and was never the constraint. The 207 figure came from
deleting the lockfile and letting npm re-resolve everything, which measures a full
re-resolve rather than this change.

---

## D6. Navigating into a pathway keeps the reader's selection

**Decision**: Double-clicking a pathway box preserves `select` rather than
replacing it with the pathway being left.

**Why**: Reported by a curator — "a searched entity is inselected if you try to
navigate to a new pathway within the diagram". The handler set `select` to the
origin pathway deliberately, to orient the reader; the sibling handler for
`.SUB.Pathway` did not, so the two ways out of a diagram disagreed.

**Measured** (2026-09-17): the flag survives and redraws (`flag=PKM`, 6 elements
then 2). Only `select` changed, from `R-HSA-70171` to `R-HSA-70326`.

**Rejected**: keeping the selection only when the new diagram contains it, falling
back to the origin otherwise. Better behaviour, but it needs a rule for an entity
appearing in several complexes, and the asymmetry settles it without one: where
you came from is one **Back** away, what you were looking at was not recoverable.

**Cost**: nothing is highlighted on arrival where the origin pathway would
previously have been.

---

## D7. A GSA parameter with no value is left out

**Decision**: `submittedParameters` omits `undefined`, `null` and `''`. `false`
and `0` are answers and are kept.

**Why**: Every parameter went through `param.value + ''`, so a field the reader
never filled in was submitted as the **string** `"undefined"` — the analysis
service being asked to email a report to an address that cannot exist.

**Not claimed**: that this is why a curator's reports were not emailed. Delivery
is GSA's, our submission path is otherwise correct, and their logs know what
arrived. Asking is cheaper than submitting analyses to reproduce it.
