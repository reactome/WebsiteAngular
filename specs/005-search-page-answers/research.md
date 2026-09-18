# Decisions behind the search-page answer panel

The chatbot team's contract (`specs/010-search-page-answers/contracts/answer_endpoint.md`
in `reactome_chatbot`) is the source of truth for the endpoint. This file records
the decisions on **our** side, which that contract leaves to us.

Each entry: what was decided, why, what was rejected, and the measurement that
settled it.

---

## D1. The token proves the request came from our server, not that a human sent it

**Decision**: the website server mints the token. It is a service-identity
token, signed `Ed25519` (EdDSA), carrying `aud`, `iat`, `exp` (120s) and an
opaque `sub`. The chatbot holds only the verifying half. The browser never sees
a key and never reaches the chatbot.

The request field is **`caller_token`**, not `human_token`. The chatbot renamed
it once this decision landed, because the old name asserted the thing we cannot
assert.

`aud` is `reactome-chatbot` and they enforce it. Asking for that rather than
accepting "checked if present" found a bug on their side: they were expecting no
audience at all, and PyJWT refuses a token carrying `aud` when none is expected,
so the first real token would have been rejected and would have read as a
signing or key-exchange fault. Measured by them:

    aud=reactome-chatbot, expecting nothing   -> InvalidAudienceError
    aud=reactome-chatbot, expecting chatbot   -> accepted
    aud=elsewhere,        expecting chatbot   -> InvalidAudienceError
    no aud,               expecting chatbot   -> MissingRequiredClaimError

`iss` is not checked and does not need to be: the signature already identifies
the minter, because we hold the only signing key. We send it anyway, and it is
ignored.

**Why**: because we have no proof of human to offer. The chatbot's D1 asks who
mints a proof-of-human token, which presumes a human gate on the search path.
There is none.

**Measured** (read off the repo 2026-09-18): the only hCaptcha in the site is in
`projects/website-angular/src/app/search/search.component.ts`, and it belongs to
the contact form — `submitContactForm()` posts its single-use response to
`/contact` and calls `resetCaptcha()`. The widget renders inside the contact
panel's markup, and the submit button is disabled until an address and a message
are filled in. So it gates one form, not the page. Its token is single-use and
already spent by the time it exists.

Every search is anonymous and ungated, and it should stay that way: nobody
solves a captcha to run a search.

So the honest claim the token can make is the one our server can actually make —
"this came from the website". Abuse control belongs at our layer, where we
already rate limit, rather than in a claim we would be inventing.

**Rejected**:

- _Minting in the browser._ Requires a signing key in client JavaScript. Not a
  weaker option, a broken one.
- _Reusing the contact form's hCaptcha response._ Single-use, spent on `/contact`,
  and scoped to a form the reader has no reason to open.
- _A captcha before a search._ Refused on UX grounds. It would cost every reader
  to deter a bot that the opt-in click in D5 already deters for free.
- _`sub` derived from the reader._ An address or an IP hash is personal data; we
  hold neither and will not start.

## D2. `sub` is an opaque per-visit id, so their rate limiter has a stable key

**Decision**: 128 random bits, minted server-side on the first answer request of
a visit and held in an `HttpOnly` cookie. Not derived from anything about the
reader. Sent as `sub` so the chatbot's limiter stops falling back to hashing the
token.

**Why**: their limiter keys on `sub` when present. A per-visit id is what rate
limiting actually wants — it survives the repeat questions of one reading
session and does not follow anyone between visits. Nothing about it identifies a
person, which is why it is safe to send.

**Rejected**: `jti` alone. Unique per token, so it aggregates nothing; a limiter
keyed on it counts every request as a new party.

## D3. We proxy server-side; the browser never calls the chatbot

**Decision**: the panel calls our own route, which calls the chatbot and streams
the events back.

**Why**: it is what makes D1 possible — the signing key stays on the server.
It also keeps the service off the public internet and puts the timeout, the
rate limit and the cache in one place we control.

**Rejected**: calling it from the browser, per the chatbot team's own
recommendation. It forces the key question to a bad answer.

## D4. Only `answered` renders. Every other state renders nothing at all

**Decision**: `nothing_found`, `refused`, `failed`, a timeout, and a dropped
connection all produce no panel, no message, no error. The search results are
untouched.

**Why**: the contract's stated design is that it must be safe to ignore, and
about one question in seven returns `nothing_found` in ~4.5s. An error for an
ordinary outcome would train readers to distrust the feature. A reader who asked
an off-topic question and got a quiet nothing has been served correctly.

**Rejected**: "no answer found" text. It reads as a fault for what is a normal
and frequent outcome, and it is noise on a page whose actual results are fine.

## D5. The panel is opt-in per query, behind a click

**Decision**: the reader asks for an answer. It does not fire on every search.

**Why**: first token is p50 9.6s, p90 12.2s, and complete is p50 10.4s, p90
18.1s (measured by the chatbot team this week, over fifteen questions, two runs
each; p50 10.8s to first token through HTTP specifically). Nothing that takes ten
seconds should start without being asked for, and search results must never wait
on it.

It is also the cheapest abuse control we have. A bot scraping search costs us
nothing, because bots do not click. That is what lets D1 stop pretending to
prove humanity.

**Rejected**: firing automatically with a spinner. The contract is explicit that
a spinner implying an imminent answer is wrong at this latency, and it would put
a model call behind every crawled search URL.

## D6. Repeat questions are cached at our layer, keyed on question and release

**Decision**: cache on our side, key `(normalised question, release)`, where
`release` is read from the `start` event. Invalidate when it changes.

**Why**: answers are not reproducible — the same question twice returns
different prose (0.33 similarity), and three runs of one question shared 4 of 19
citations, because query expansion is itself a model call. Without a cache, a
reader who reloads sees a different answer and different sources, which reads as
unreliability. The cache also turns a ten-second wait into nothing on a repeat.

**Rejected**: letting them cache it. The invalidation key is on their event but
the reload is our UX problem, and we are the only client once D3 holds.

## D7. Prose is Markdown, rendered without HTML, citations resolved to stable ids

**Decision**: render `token` text as Markdown with HTML disabled. Citations come
from `citation` events, not from the prose, and link to
`/content/detail/<st_id>`. At most 12, presented as the most relevant few rather
than a complete source list.

**Why**: the contract states the text is Markdown and never HTML, that anchors
are stripped on this path, and that the 12 cap binds on ordinary questions.
Calling a capped list "Sources" would overstate it.

**Rejected**: passing the text through as HTML. The contract does not promise
HTML, so accepting it would be accepting whatever arrives.

---

## Open, and not ours to close

- **The verifying key has to reach them, and the signing key has to be
  provisioned on our side.** Neither half belongs in this repository, or in
  theirs. Until the exchange happens there is nothing to build against.
- **The endpoint is live on beta**, confirmed 18 Sep 2026 by calling it rather
  than by being told. That morning it was `405 allow: GET` -- Chainlit's SPA
  catch-all. Now:

      POST /chat/guest/api/answer   ->  HTTP 200
      event: done
      data: {"state": "refused", "seconds": 0.0}

  Which is the contract behaving correctly: always 200, the outcome in `state`.
  It refuses because the caller token was not a real one. So the endpoint is no
  longer the blocker -- the key is, and every call answers `refused` in 0.0s
  until one is exchanged. That is also why the e2e stubs the stream instead of
  calling it.

- **D5 is a UX change to the search page** and wants Adam's sign-off before it
  is built, not after.

## Settled by measurement, so we do not have to build for it

**Closing the connection is the cancellation.** A reader who navigates away mid
answer does not leave a model call running: a client hang-up raises
`CancelledError` in their generator and nothing further is produced — they read
3 tokens, hung up, and the server produced exactly 3. So the proxy needs no
upstream cancel call. Their one stated limit on that: whether the provider still
bills a partially generated completion is not measured.
