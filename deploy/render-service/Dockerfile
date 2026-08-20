# The headless render service: diagram figures for documents, drawn by the site's
# own renderer.
#
# Built from node:22 plus Chromium rather than from a Playwright image. The
# Playwright images carry three browsers and land around 3 GB; this needs one
# browser, and node:22 is already on the box as the app image's base, so its
# layers are shared rather than downloaded again.
FROM node:22

# Chromium and the system libraries it needs. --with-deps runs apt, so it has to
# happen before dropping root. Chromium only: nothing here opens Firefox.
WORKDIR /render
COPY tools/render/package.json ./
RUN npm install --omit=dev \
    && npx playwright install --with-deps chromium \
    && npm cache clean --force

COPY tools/render/*.mjs ./

# Renders arrive from the network. Nothing here needs root, and the browser is
# the part running untrusted-ish input (a page of our own, but a page).
RUN mkdir -p /cache && chown -R node:node /cache /render
USER node

ENV RENDER_HOST=0.0.0.0 \
    RENDER_PORT=4310 \
    RENDER_CACHE=/cache

# 0.0.0.0 inside the container, and the port deliberately NOT published to the
# host in docker-compose.yml. The service is reachable from the app container
# and nowhere else, which keeps the property that matters: a render can only be
# commissioned through whatever fronts the site.
EXPOSE 4310

# A render is a page load, a wait and an export; if the browser wedges, the
# process is the thing to replace. Compose restarts it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "service.mjs"]
