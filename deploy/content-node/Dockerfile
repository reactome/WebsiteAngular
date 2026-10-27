# The node port of the content service.
#
# node:24 for the same reason the render service uses it: it is already on this
# box as the app image's base, so the layers are shared rather than downloaded
# again. Nothing else is needed -- this reads a graph and shapes JSON.
FROM node:24

WORKDIR /content-node

# Only what the service imports, at the versions the root package.json pins,
# read from it rather than restated here (as the render service does). The
# repository's own lockfile would drag in Angular, Playwright and the CMS to
# run two packages. A pin restated here stayed at express 5.2.1 when
# Dependabot moved the root to 5.3.0 (it watches only the root), so the image
# would have run a version nothing here tested.
COPY package.json ./root-package.json
RUN node -e " \
      const root = require('./root-package.json'); \
      const dependencies = {}; \
      for (const name of ['express', 'neo4j-driver']) { \
        const version = (root.dependencies ?? {})[name]; \
        if (!version) throw new Error(name + ' is not a dependency of the root package'); \
        dependencies[name] = version; \
      } \
      require('node:fs').writeFileSync('package.json', JSON.stringify({ \
        name: 'reactome-content-node', private: true, dependencies \
      }, null, 2)); \
    " \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm root-package.json

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
