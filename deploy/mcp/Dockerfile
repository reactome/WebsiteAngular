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
# So the revision is an argument. MCP_REF is a tag, branch or commit, and the
# build clones exactly that. Nobody's checkout is part of the deployment, and
# `docker compose build` twice from the same ref gives the same server.
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
# --depth 1 against a ref name; a full clone then checkout would be needed for a
# bare commit sha, which is why MCP_REF is documented as a branch or tag.
RUN git clone --depth 1 --branch "${MCP_REF}" "${MCP_REPO}" .
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
