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

# 5. Copy the rest of the code
COPY . .

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

# 6. Hand the whole tree -- including the node_modules the anonymous volume is
# seeded from -- to the unprivileged user, then stop being root. This comes
# after the dependency install so that changing UID/GID does not invalidate
# that layer and force a full reinstall.
RUN chown -R "$UID":"$GID" /app
USER node

# Expose the ports
EXPOSE 4200
EXPOSE 4001

# We use "npm run dev:serve" but pass the flags through the -- separator.
# The IPv4 proxy runs in the background because `tinacms dev` only binds to
# ::1:4001; docker port-publish is IPv4-only, so without this the admin UI
# is unreachable from the host (and from any SSH tunnel into it).
# stage-content compiles the authored .mdx into the JSON the app fetches; the
# dev server cannot serve .mdx (vite treats that extension as JSX source).
CMD npx tsx projects/website-angular/src/scripts/generate-index.ts && \
    npx tsx projects/website-angular/src/scripts/stage-content.ts && \
    (node projects/website-angular/src/scripts/tina-ipv4-proxy.js &) && \
    npx tinacms dev --rootPath projects/website-angular -c "ng serve --host 0.0.0.0 --poll 2000 --allowed-hosts beta.reactome.org --allowed-hosts localhost"