# Deploying the render service

The service is `tools/render/service.mjs`. This directory is how it gets run: a
container that compose restarts, rather than something installed on a host.

## Running it

```bash
docker compose up -d render      # builds on first run, ~2.15 GB image
docker compose logs -f render
curl -s http://127.0.0.1:4310/health
```

On this box the site itself runs on the host rather than in compose, so the
container renders `host.docker.internal:4200` and publishes 4310 **on loopback**
for the host's `serve-prod` to proxy. Where both are containers, drop the
`ports:` line and set `RENDER_BASE=http://app:4200`.

Two things that cost time getting this up, both worth knowing:

- **The browser has to live outside either user's home.** `playwright install` puts
  it in the installing user's cache, so running it as root and the service as
  `node` gives a container that builds, starts, reports **healthy**, and fails
  every render with "Executable doesn't exist". `PLAYWRIGHT_BROWSERS_PATH` fixes
  it. Note what the health check does not prove: it only says the HTTP server is
  up, not that a browser can launch.
- **A first `up` that fails on the port leaves a container that will not publish
  it.** The binding is in `HostConfig` but `NetworkSettings.Ports` stays empty
  even after a successful start; `docker compose up -d --force-recreate render`
  is the fix.

`restart: unless-stopped` means a wedged browser or an out-of-memory kill costs
one request rather than the feature; there is no state to lose except the cache,
which is on the `render-cache` volume and survives replacement -- verified, a
repeat request after a container replacement is a 6ms cache hit.

The policy is **configured but not proven by test here**. A crash is hard to
simulate honestly: `docker kill` is a manual stop, which docker deliberately does
not restart; `kill -9 1` inside the container is ignored, because the kernel
shields a namespace's init from its own signals; and signalling the process from
the host needs root. Take the policy on docker's terms, or confirm it the next
time the box reboots.

The image is `node:22` plus Chromium, not a Playwright image. The Playwright
images carry three browsers and land around 3 GB; this needs one, and node:22 is
already here as the app image's base, so the layers are shared. It installs four
packages rather than the site's whole tree, and reads their versions out of the
root `package.json` at build time rather than restating them: dependabot only
watches the root, so a second set of pins would silently fall behind, and a
Playwright that does not match its browser download fails in a way that looks
like a rendering bug.

Running on the host instead, without a container:

```bash
RENDER_CACHE=~/render-cache RENDER_BASE=http://localhost:4200 \
  setsid nohup node tools/render/service.mjs > ~/render-service.log 2>&1 &
```

That is what beta runs today. It does not survive a reboot, which is the reason
to move to the container.

## How the site reaches it

`proxy.conf.js` maps `/RenderService` to `RENDER_TARGET`, defaulting to
`127.0.0.1:4310` for a host run; compose sets it to `http://render:4310`.
`serve-prod.js` reads the same table, so beta and the dev server both proxy it,
and the app builds its URLs from `RENDER_SERVICE` — `window.location.origin +
'/RenderService'` — exactly as it does for `CONTENT_SERVICE`.

Nothing was added to Apache: beta.reactome.org already forwards to :4200.

## The property to preserve

**The service must not be publicly addressable in its own right.** A render costs
seconds of CPU and a browser's worth of memory, and crawlers hitting the old
`/ContentService/exporter/*` endpoints are what exhausted Tomcat's heap and took
the origin down. So the container publishes no port: it is reachable from the app
container and nowhere else, and every render is commissioned through whatever
fronts the site.

Three things bound the damage when it is fronted:

- two concurrent renders, eight queued, `503` with `Retry-After` beyond that
- a content-addressed disk cache, so a repeat is a file read (~7ms)
- an id that does not resolve is rejected by one backend call, before a browser
- every number in the query string is clamped — `scale=50` asked for a
  320-megapixel canvas and got it, which is worse than an error

## Before this fronts reactome.org

- **Rate limiting at Apache.** A bounded queue keeps the service alive under a
  crawl; it does not stop the crawl. There is an `add-rate-limit.sh` on the dev
  box for this.
- **Apache serving the cache directly** on a hit, falling through to the
  container only on a miss, so a popular figure never involves the renderer.
- **A cache key per release.** `RENDER_CACHE_KEY` exists for it; bump it when the
  data changes or figures outlive their diagrams.

## One knob: RENDER_CACHE_KEY

Bump it whenever the renderer's **output** changes, not whenever the code does.
It keys the service's disk cache and is the `ETag`, so it is what makes a figure
drawn by an older renderer stop being served.

Figures go out as `Cache-Control: private, no-cache`, so nothing reuses one
without asking. That is not a performance decision — the expensive part is the
render, which is cached on disk here, and a conditional request is a 304 and one
round trip. Longer caching let a figure outlive its renderer: `public` meant
Cloudflare stored it and kept serving it with the max-age it was stored under,
Cloudflare's Browser Cache TTL overrode what the service sent anyway (300s went
out as 4h), and a download link's URL is never revalidated by reloading the page.

There was briefly a second version stamped into every figure's URL to defeat all
that. It worked, and it was one more thing to remember to bump in step; the
no-cache header does the same job with nothing to remember.

## Watching it

```bash
curl -s http://127.0.0.1:4310/health     # served, hits, rendered, failed, rejected
docker compose exec render du -sh /cache
```

`rejected` counts `503`s and is deliberately separate from `failed`: a rejection
is the queue doing its job, and counting it as a failure hides real ones in the
noise of a busy period.
