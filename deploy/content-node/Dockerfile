# The node port of the content service.
#
# node:24 for the same reason the render service uses it: it is already on this
# box as the app image's base, so the layers are shared rather than downloaded
# again. Nothing else is needed -- this reads a graph and shapes JSON.
FROM node:24

WORKDIR /content-node

# Only what the service imports, at the versions the repository resolves and
# tests: each must be a dependency of the root package.json, and is installed
# at the version the root lockfile resolved for it. The repository's own
# lockfile would drag in Angular, Playwright and the CMS to run two packages.
# A pin restated here stayed at express 5.2.1 when Dependabot moved the root
# to 5.3.0 (it watches only the root); a range read from package.json
# (neo4j-driver's ^6.2.0) would take the newest 6.x at build time, untested.
# Their own dependencies still resolve at build time, within express's and
# the driver's ranges.
COPY package.json ./root-package.json
COPY package-lock.json ./root-lock.json
RUN node -e " \
      const root = require('./root-package.json'); \
      const lock = require('./root-lock.json'); \
      const dependencies = {}; \
      for (const name of ['express', 'neo4j-driver']) { \
        if (!(root.dependencies ?? {})[name]) \
          throw new Error(name + ' is not a dependency of the root package'); \
        const locked = (lock.packages ?? {})['node_modules/' + name]; \
        if (!locked?.version) throw new Error(name + ' is not in the root lockfile'); \
        dependencies[name] = locked.version; \
      } \
      require('node:fs').writeFileSync('package.json', JSON.stringify({ \
        name: 'reactome-content-node', private: true, dependencies \
      }, null, 2)); \
    " \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm root-package.json root-lock.json

COPY tools/content-node/ ./tools/content-node/
# The nearest package.json is what tells Node a .ts module is a module (spec
# 013): without it Node warns on every start, loads each file twice and the
# type checker reads them as CommonJS. The one npm writes above has no type.
COPY tools/package.json ./tools/package.json

# Loopback of whatever network namespace it lands in. With `network_mode: host`
# in compose that is the host's loopback, which is the point: Neo4j binds to
# 127.0.0.1 only and widening it so a bridged container could reach it would be
# the wrong trade for a convenience.
ENV CONTENT_NODE_HOST=127.0.0.1
ENV CONTENT_NODE_PORT=4400
# Express's own error pages leave out the stack trace only in production. Every
# failure is answered in Java's envelope anyway; this is the floor under that.
ENV NODE_ENV=production

USER node
CMD ["node", "tools/content-node/server.ts"]
