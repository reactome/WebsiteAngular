# The site itself, in production form (specs/032 T007, research R2): the build
# beta serves, and serve-prod.js to serve it, so a host needs no Node of its own.
#
# Built in CI and published (specs/032 R1). A host with little free memory --
# the release server -- pulls it rather than building it: the Angular build is
# the one step here that needs several gigabytes.
#
#     docker build -f deploy/site/Dockerfile -t site .
#     docker run --network host -e SITE_PROFILE=release site
#
# One image for every deployment that serves itself: the build is beta's, and a
# host that is not beta names its own row with SITE_PROFILE (serve-prod.js).

FROM node:24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# What `npm run build:beta` does, as beta's deploy builds it: the two libraries
# the site imports from dist/, the site-page search index and the compiled CMS
# content (both generated and gitignored -- without them the site has no page
# search and no content), the site, and the embeddable diagram.
RUN npm run build:libs \
    && npm run generate:indices \
    && npm run stage:content \
    && npx ng build reactome --configuration production,beta \
    && npx ng build reactome-diagram-element --configuration beta

FROM node:24-slim
WORKDIR /site
# serve-prod.js and the modules it loads need three packages at run time, at
# the versions the repository's own package.json names (as the render image
# does): the contact form sends through Amazon SES's SDK, as the image has no
# sendmail (specs/032 T031). Not the whole dependency tree: that is Angular and
# its build, none of which runs here.
COPY package.json ./root-package.json
RUN node -e " \
      const root = require('./root-package.json'); \
      const needed = ['express', 'http-proxy-middleware', '@aws-sdk/client-sesv2']; \
      const dependencies = {}; \
      for (const name of needed) { \
        const version = (root.dependencies ?? {})[name] ?? (root.devDependencies ?? {})[name]; \
        if (!version) throw new Error(name + ' is not a dependency of the root package'); \
        dependencies[name] = version; \
      } \
      require('node:fs').writeFileSync('package.json', JSON.stringify({ \
        name: 'reactome-site', private: true, dependencies \
      }, null, 2)); \
    " \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm root-package.json
# Laid out as in the repository: serve-prod.js finds proxy.conf.js four levels
# above itself.
COPY proxy.conf.js ./
COPY projects/website-angular/src/scripts/serve-prod.js \
     projects/website-angular/src/scripts/search-answer-proxy.js \
     projects/website-angular/src/scripts/contact-route.js \
     projects/website-angular/src/scripts/human-gate.js \
     ./projects/website-angular/src/scripts/
COPY --from=build /app/dist/reactome/browser ./dist/reactome/browser
COPY --from=build /app/dist/reactome-diagram/browser ./dist/reactome-diagram/browser
USER node
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=4200
EXPOSE 4200
# /health answers whether or not the services behind it are up (it reports
# them), so this says only that the site is serving -- which is the question.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4200) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "projects/website-angular/src/scripts/serve-prod.js"]
