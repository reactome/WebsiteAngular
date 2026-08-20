# Deploying the render service

The service is `tools/render/service.mjs`. This directory is how it gets run: a
container that compose restarts, rather than something installed on a host.

## Running it

```bash
docker compose up -d render      # builds on first run
docker compose logs -f render
docker compose exec render node -e "fetch('http://127.0.0.1:4310/health').then(r=>r.text()).then(console.log)"
```

`restart: unless-stopped` means a wedged browser or an out-of-memory kill costs
one request rather than the feature; there is no state to lose except the cache,
which is on the `render-cache` volume and survives replacement.

The image is `node:22` plus Chromium, not a Playwright image. The Playwright
images carry three browsers and land around 3 GB; this needs one, and node:22 is
already here as the app image's base, so the layers are shared. `tools/render/`
has its own `package.json` for the same reason — four packages instead of the
site's whole tree — and `render-deps.spec.ts` fails if its pins drift from the
root's. That matters most for Playwright, whose browser download is
version-locked to the library.

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

## Two versions, and why

Changing the renderer means two things have to be bumped together:

| where                                     | what it invalidates                          |
| ----------------------------------------- | -------------------------------------------- |
| `RENDER_CACHE_KEY` in `service.mjs`       | the service's own disk cache, and the `ETag` |
| `RENDER_VERSION` in `download.service.ts` | every cache downstream, by changing the URL  |

Headers alone are not enough. A figure is served `public`, so Cloudflare stores
it and keeps serving that copy with the max-age it was stored under — a day, in
the case that sent curators a 2000px GIF after the full-size fix had shipped.
Reloading the page does not help, because a download link's URL is never
revalidated, and Cloudflare's Browser Cache TTL setting overrides the max-age the
service sends anyway (it rewrote 300s to 4h). The only thing every layer respects
is a different address.

The service ignores the `v` parameter, so both versions of a figure share one
entry in its disk cache; only the downstream address changes.

## Watching it

```bash
curl -s http://127.0.0.1:4310/health     # served, hits, rendered, failed, rejected
docker compose exec render du -sh /cache
```

`rejected` counts `503`s and is deliberately separate from `failed`: a rejection
is the queue doing its job, and counting it as a failure hides real ones in the
noise of a busy period.
