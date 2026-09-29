# Quickstart: validate the embeddable diagram

## Build

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
npm run build:libs
npx ng build reactome-diagram-element --configuration development   # or production / beta
ls dist/reactome-diagram/browser                                     # main.js, chunk-*.js, reactome-diagram.js, demo.html, media/
```

## See it on a page of another origin

Serve the build from one port and a host page from another. The e2e spec does exactly this. By hand:

```bash
npx http-server dist/reactome-diagram/browser -p 4340 --cors -c-1 &
npx http-server specs/009-embeddable-diagram/host-page -p 4341 -c-1 &
# open http://localhost:4341/  (its <script> points at http://localhost:4340/reactome-diagram.js)
```

**Expected**:

- The pathway draws in the box.
- Zoom, pan, hover and select work.
- The address bar never changes.
- The host page's deliberately garish styles don't reach inside the diagram.

## Automated checks

```bash
E2E_PORT=4330 npx playwright test e2e/embed-diagram.spec.ts --project=code
```

Covered, each by visible outcome:

- the diagram draws;
- interaction works;
- host URL, history and scroll are unchanged;
- style isolation, checked with pixels;
- two diagrams on one page;
- remove and re-add;
- loading the script twice;
- the attributes (select, flag, analysis) and their events;
- every old-interface method and handler, plus a copy of AllianceGenome's integration;
- exporter image addresses and legacy links answer.

## On beta

1. `https://beta.reactome.org/embed/diagram/v1/demo.html` shows the demo.
2. From a page on another origin, the classic script loads it. Check its response headers include `Access-Control-Allow-Origin: *`.
3. Beta's `/health` bundle date must postdate the merge before verifying.
