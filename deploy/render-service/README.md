# Deploying the render service

The service itself is `tools/render/service.mjs`; this directory is how it gets
run on the dev box, and what still needs deciding before it fronts the public
site.

## Install

```bash
sudo cp deploy/render-service/reactome-render.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now reactome-render
curl -s http://127.0.0.1:4310/health
```

Until that is done it runs under `nohup`, which does not survive a reboot:

```bash
RENDER_CACHE=/home/awright/render-cache RENDER_BASE=http://localhost:4200 \
  setsid nohup node tools/render/service.mjs > ~/render-service.log 2>&1 &
```

## How the site reaches it

`proxy.conf.js` maps `/RenderService` to `127.0.0.1:4310`, and `serve-prod.js`
reads that same table, so beta and the dev server both proxy it. The app builds
its URLs from `RENDER_SERVICE` in `environments/environment.ts`, which is
`window.location.origin + '/RenderService'` — so it follows whatever host the
bundle is served from, exactly as `CONTENT_SERVICE` does.

Nothing was added to Apache: beta.reactome.org already forwards everything to
:4200.

## Before this fronts reactome.org

The service binds to loopback and is reached only through the site, which is the
first line of defence: a render costs seconds, and **crawlers hitting the old
`/ContentService/exporter/*` endpoints are what exhausted Tomcat's heap and took
the origin down**. Proxying `/RenderService` means the public can now commission
renders on beta, and three things bound the damage:

- two concurrent renders, eight queued, `503` with `Retry-After` beyond that
- a content-addressed disk cache, so a repeated request is a file read (7ms)
- an id that does not resolve is rejected by one backend call, before a browser

What is **not** yet in place for production:

- **Rate limiting at Apache.** There is an `add-rate-limit.sh` on this box for
  exactly this. A bounded queue keeps the service alive under a crawl; it does
  not stop the crawl.
- **Serving the cache directly.** The right shape is Apache serving
  `/home/awright/render-cache` for a hit and only falling through to node on a
  miss, so a popular figure never involves the renderer at all.
- **A cache key per release.** `RENDER_CACHE_KEY` exists for this; bump it when
  the data changes or figures will outlive their diagrams.

## Watching it

```bash
curl -s http://127.0.0.1:4310/health          # counters: served, hits, rendered, failed, rejected
journalctl -u reactome-render -f              # once installed
du -sh /home/awright/render-cache
```

`rejected` counts `503`s and is deliberately separate from `failed`: a rejection
is the queue doing its job, and counting it as a failure hides real ones in the
noise of a busy period.
