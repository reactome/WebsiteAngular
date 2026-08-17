FROM node:22

WORKDIR /app

# 1. Install Global Tools
RUN npm install -g @angular/cli@21 tsx

# 2. Copy Package files
COPY package*.json ./

# 3. Inject the Host/Poll flags directly into the package.json scripts
# This prevents the "Invalid Option: --host" error
RUN sed -i 's/ng serve/ng serve --host 0.0.0.0 --poll 2000/g' package.json

# 4. Install Dependencies
RUN npm install --legacy-peer-deps --ignore-scripts

# The dev server runs against a bind-mounted working copy, so everything it
# writes -- .angular/cache, generated content, dist -- lands in the developer's
# own checkout. Running as root leaves those files root-owned, which then makes
# host-side `ng build` collide with the container's build cache and leaves files
# the developer cannot even delete. Re-point the image's existing `node` user at
# the host's ids so the ownership simply matches.
#
# Pass the real values through .env (see .env.example); the 1000 defaults are
# what a stock Linux desktop uses.
ARG UID=1000
ARG GID=1000
RUN set -eu; \
    if [ "$GID" != "1000" ] && ! getent group "$GID" >/dev/null; then \
      groupmod -g "$GID" node; \
    fi; \
    if [ "$UID" != "1000" ] || [ "$GID" != "1000" ]; then \
      usermod -u "$UID" -g "$GID" node; \
    fi; \
    mkdir -p /home/node; \
    chown -R "$UID":"$GID" /home/node

# 5. Copy the rest of the code, already owned correctly, and stop being root.
#
# node_modules is deliberately NOT chowned. It only needs to be readable, and
# `chown -R` over ~1.6 GB of it took ten minutes and produced a layer holding
# the whole tree a second time -- which is what filled the disk. At runtime
# /app is a bind mount of the developer's checkout anyway; the only thing that
# survives from the image is the node_modules volume, which is read-only in
# practice.
COPY --chown=$UID:$GID . .
USER node

# Expose the ports
EXPOSE 4200
EXPOSE 4001

# beta serves a PRODUCTION build, not `ng serve`.
#
# The dev server ships ~143 unbundled ES modules and 13 MB per page load. Over
# loopback that is 2.5s; through this host's Apache and Cloudflare it was 160s,
# and the Pathway Browser routinely never finished loading at all. The
# production build is ~424 kB over about a dozen requests, and is also what
# real users actually run, so beta now shows what they will see.
#
# `--watch` keeps that from costing developer iteration: a source change
# rebuilds into dist/ and the next request serves it. `--delete-output-path
# false` stops each rebuild from emptying the directory the server is reading.
# serve-prod.js waits for the first build rather than exiting, since on a cold
# start dist/ is empty for the minute or so the build takes.
#
# The IPv4 proxy runs in the background because `tinacms dev` only binds to
# ::1:4001; docker port-publish is IPv4-only, so without this the admin UI is
# unreachable from the host (and from any SSH tunnel into it).
# stage-content compiles the authored .mdx into the JSON the app fetches.
CMD npx tsx projects/website-angular/src/scripts/generate-index.ts && \
    npx tsx projects/website-angular/src/scripts/stage-content.ts && \
    (node projects/website-angular/src/scripts/tina-ipv4-proxy.js &) && \
    npx tinacms dev --rootPath projects/website-angular -c "sh -c 'npm run build:watch & npm run serve:prod'"