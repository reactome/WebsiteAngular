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
# lockfile would drag in Angular, Playwright and the CMS to run three packages
# (the third, Amazon SES's client, sends the help-desk form's mail).
# A pin restated here stayed at express 5.2.1 when Dependabot moved the root
# to 5.3.0 (it watches only the root); a range read from package.json
# (neo4j-driver's ^6.2.0) would take the newest 6.x at build time, untested.
# Their own dependencies still resolve at build time, within express's and
# the driver's ranges.
#
# sbgn-exporter (an event's SBGN, its spec 001 T018) is no registry package:
# the root pins a commit of its repository's dist branch, which the lockfile
# records as a git URL. Its lockfile version, 0.0.0, would ask the registry for
# a package of that name -- none, or someone else's -- so it is installed from
# the lockfile's `resolved` commit instead, and anything else is refused. npm
# writes that URL as git+ssh, and fetches a GitHub commit as its tarball over
# HTTPS either way; the URL is rewritten to HTTPS and SSH is made to fail, so
# the build needs no key. The dist branch's package has no dependencies, so
# nothing of its command line's (the graph driver it lists, the comparison's
# parser) comes with it: checked below.
COPY package.json ./root-package.json
COPY package-lock.json ./root-lock.json
RUN node -e " \
      const root = require('./root-package.json'); \
      const lock = require('./root-lock.json'); \
      const dependencies = {}; \
      for (const name of ['express', 'neo4j-driver', '@aws-sdk/client-sesv2', 'sbgn-exporter']) { \
        if (!(root.dependencies ?? {})[name]) \
          throw new Error(name + ' is not a dependency of the root package'); \
        const locked = (lock.packages ?? {})['node_modules/' + name]; \
        if (!locked?.version) throw new Error(name + ' is not in the root lockfile'); \
        dependencies[name] = locked.version; \
      } \
      const commit = /^git\\+(?:ssh:\\/\\/git@|https:\\/\\/)github\\.com\\/reactome\\/sbgn-exporter\\.git#([0-9a-f]{40})$/ \
        .exec(lock.packages['node_modules/sbgn-exporter'].resolved ?? ''); \
      if (!commit) throw new Error('sbgn-exporter is not locked to a commit of its repository'); \
      dependencies['sbgn-exporter'] = 'git+https://github.com/reactome/sbgn-exporter.git#' + commit[1]; \
      require('node:fs').writeFileSync('package.json', JSON.stringify({ \
        name: 'reactome-content-node', private: true, dependencies \
      }, null, 2)); \
    " \
    && GIT_SSH_COMMAND=false npm install --omit=dev --no-audit --no-fund \
    && node -e " \
      const pkg = require('./node_modules/sbgn-exporter/package.json'); \
      if (Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).length) \
        throw new Error('sbgn-exporter brings dependencies of its own'); \
      for (const name of ['saxes', 'xmlchars']) \
        if (require('node:fs').existsSync('node_modules/' + name)) \
          throw new Error(name + ', the comparison\\'s, is installed'); \
    " \
    && npm cache clean --force \
    && rm root-package.json root-lock.json

COPY tools/content-node/ ./tools/content-node/
# The nearest package.json is what tells Node a .ts module is a module (spec
# 013): without it Node warns on every start, loads each file twice and the
# type checker reads them as CommonJS. The one npm writes above has no type.
COPY tools/package.json ./tools/package.json
# The API description it publishes at /ContentService/openapi.json (spec 016,
# T028), generated from the contract, at the path the service reads it from.
COPY projects/contract/openapi.json ./projects/contract/openapi.json

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
