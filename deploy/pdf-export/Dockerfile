# The PDF service (spec 006 T100): pdf-export's single-event service, `pdf-export
# serve` (pdf-export spec 001, Story 2, contracts/service.md), which node calls
# for an event's PDF at /ContentService/exporter/document/event/{id}.pdf. It
# reads the graph, draws its figures through the render service, reads an
# analysis token's results from the AnalysisService, and prints with Chromium.
#
# Built from the commit deploy/java/PINS.md records ("The PDF service"), from
# GitHub's archive of it: nothing but that commit. pins.spec.ts checks the two
# agree.
#
# node:24 rather than a Playwright image, as the render service is built: one
# browser, and node:24's layers are already on the host.
FROM node:24

ARG PDF_EXPORT_COMMIT=979b8d6d436c1edcf7e54e104c04c617f12692a8

# Where the browser goes: outside any user's home, as the service runs as the
# owner of the graph's credentials file, not as the user that installed it
# (deploy/render-service/Dockerfile says what the home's copy cost there).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /pdf-export

# The tree at its commit, and its packages as its lockfile pins them, the
# development ones too: the service compiles the website's theme package with
# sass when it starts (src/layout/theme.ts).
#
# Two layers, each removing its own downloads: about 300 MB, then about
# 550 MB. Building a layer briefly takes about twice its size on disk: one
# layer of both peaked near 1.7 GB, two peak near 1.4 GB.
RUN set -eu; \
    curl -fsSL "https://codeload.github.com/reactome/pdf-export/tar.gz/$PDF_EXPORT_COMMIT" \
      | tar -xz --strip-components=1; \
    npm ci --no-audit --no-fund; \
    npm cache clean --force; \
    printf '%s\n' "$PDF_EXPORT_COMMIT" > COMMIT

# Chromium's headless shell and the libraries it needs, as pdf-export's CI
# installs them, by the playwright-core its lockfile pins.
RUN set -eu; \
    npx playwright-core install --with-deps --only-shell chromium; \
    npm cache clean --force; \
    rm -rf /var/lib/apt/lists/*

COPY deploy/pdf-export/entrypoint.sh /usr/local/bin/pdf-export-entrypoint

# Chromium wants a home it can write; the service's user has none here.
ENV HOME=/tmp \
    BIND_ADDRESS=127.0.0.1 \
    PORT=4370

# A user with no rights here: compose runs it as the credentials file's owner.
USER node
EXPOSE 4370

# The graph's credentials read from the file content-node reads, then the
# service. Its settings are contracts/cli.md's: the environment's here, and the
# release's folder (the EHLD summary) and the concurrency as flags.
ENTRYPOINT ["/usr/local/bin/pdf-export-entrypoint"]
CMD ["node", "src/cli.ts", "serve", "--files", "/files", "--concurrency", "2"]
