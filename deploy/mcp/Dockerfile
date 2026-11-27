# The MCP server, built from a git ref rather than from a working checkout.
#
# The first version of this bind-mounted somebody's clone and ran `dist/`, which
# is gitignored. What that deploys is "whatever branch was checked out, compiled
# whenever anyone last ran a build" -- and the failure is silent, because the
# image, the compose file and the route all look exactly as intended. It had
# already happened once: a container up for four days was running code that no
# longer existed on disk, because a test run had rebuilt `dist/` from an
# unmerged branch as a side effect.
#
# So the revision is an argument. MCP_REF is a branch or tag, and the build
# clones exactly that -- nobody's checkout is part of the deployment. Note what
# that does and does not promise: `main` is a moving ref, so two builds of
# `main` are two revisions, deliberately. What is guaranteed is that the build
# follows the ref rather than a cached copy of it, and that the commit it
# actually used is recorded in /srv/REVISION where it can be read back.
#
# Lives here rather than in reactome-mcp because that repository has no
# Dockerfile at all -- checked, nothing tracked -- and this is the repository
# that now runs the service.

FROM node:22-slim AS build
ARG MCP_REF=main
ARG MCP_REPO=https://github.com/reactome/reactome-mcp.git
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Fetch the ref with BuildKit's own `ADD` of a git repository, which resolves
# MCP_REF to a commit on every build and keys the layer on that commit.
#
# Without that the build is stale by default and silent about it. `RUN git
# clone --branch main` is one fixed command string, so Docker caches its layer
# and reuses it for ever: once main moves, `docker compose build` rebuilds the
# revision from the first build and reports success. Verified rather than
# assumed -- a second `docker compose build mcp` with no changes reported CACHED
# for every step including the clone.
#
# Here, when the ref points somewhere new the layer and everything after it are
# invalidated; when it has not moved the build stays cached. It asks git
# itself (over HTTPS, as `git ls-remote` does), not GitHub's REST API: an
# earlier version `ADD`ed `api.github.com/.../commits/<ref>` to the same end,
# unauthenticated, and shared CI runners can exhaust the API's anonymous limit
# (specs/032 T033). No token is needed, here, in CI or in compose.
#
# `--keep-git-dir` keeps .git, for the REVISION below; it never reaches the
# final stage.
#
# Build with BuildKit (compose, buildx, or CI's `docker build`): the legacy
# builder ignores the flag and fetches the repository's web page as a file, and
# the build then fails at `npm ci` for want of package.json.
#
# It is the same defect as the bind-mount this replaced, one level up: a
# deployment whose revision is decided by something nobody looked at.
ADD --keep-git-dir=true ${MCP_REPO}#${MCP_REF} /build
# `npm ci` rather than `install`: the lockfile is the point of pinning a ref.
RUN npm ci
RUN npm run build
# The revision that was actually built, readable from the running container.
# Without it, "which commit is this serving" has no answer once the build host
# is gone.
RUN git rev-parse HEAD > /build/REVISION
RUN npm prune --omit=dev

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/REVISION ./REVISION
# Not root. It reads Reactome over HTTPS and writes nothing.
USER node
CMD ["node", "dist/http-server.js"]
