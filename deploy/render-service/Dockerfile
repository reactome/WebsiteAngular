# The headless render service: diagram figures for documents, drawn by the site's
# own renderer.
#
# Built from node:22 plus Chromium rather than from a Playwright image. The
# Playwright images carry three browsers and land around 3 GB; this needs one
# browser, and node:22 is already on the box as the app image's base, so its
# layers are shared rather than downloaded again.
FROM node:22

# Where the browser goes.
#
# Without this, `playwright install` puts it in the *installing* user's home --
# /root/.cache/ms-playwright -- and the service, which runs as `node`, looks in
# /home/node/.cache/ms-playwright and finds nothing. The container built, started,
# reported healthy, and failed every render with "Executable doesn't exist".
# A path outside either home, owned by node, cannot go wrong that way.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /render

# The four packages the service actually imports, at the versions the repo
# already pins -- taken from the root package.json rather than restated here.
#
# A second manifest with its own pins was the obvious way to do this and the
# wrong one: dependabot only watches the root, so a bump there would leave this
# behind, and a Playwright whose version does not match its browser download
# fails in a way that looks like a rendering bug. One source of truth means the
# container cannot disagree with the CLI everything was tested against.
#
# Adding an import to the service means adding it here too; `docker compose up
# render` is what proves it.
COPY package.json ./root-package.json
RUN node -e " \
      const root = require('./root-package.json'); \
      const needed = ['express', '@playwright/test', 'gifenc', 'fflate']; \
      const dependencies = {}; \
      for (const name of needed) { \
        const version = (root.dependencies ?? {})[name] ?? (root.devDependencies ?? {})[name]; \
        if (!version) throw new Error(name + ' is not a dependency of the root package'); \
        dependencies[name] = version; \
      } \
      require('node:fs').writeFileSync('package.json', JSON.stringify({ \
        name: 'reactome-render-service', private: true, type: 'module', dependencies \
      }, null, 2)); \
    " \
    && npm install --omit=dev \
    && npx playwright install --with-deps chromium chromium-headless-shell \
    && chown -R node:node /ms-playwright \
    && npm cache clean --force \
    && rm root-package.json

COPY tools/render/*.mjs ./

# Renders arrive from the network. Nothing here needs root, and the browser is
# the part handling input.
RUN mkdir -p /cache && chown -R node:node /cache /render
USER node

ENV RENDER_HOST=0.0.0.0 \
    RENDER_PORT=4310 \
    RENDER_CACHE=/cache

# 0.0.0.0 inside the container, which is the container's own interface and not
# the box's. docker-compose.yml publishes it to 127.0.0.1 only -- never 0.0.0.0
# -- because on the dev box the site runs on the host rather than in compose, so
# it cannot reach a sibling by service name. Either way the property that matters
# holds: a render can only be commissioned through whatever fronts the site.
EXPOSE 4310

# A render is a page load, a wait and an export; if the browser wedges, the
# process is the thing to replace. Compose restarts it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "service.mjs"]
