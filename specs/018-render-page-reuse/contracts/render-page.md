# Contract: the render page's in-app navigation

The render page (`/PathwayBrowser/render` and `/PathwayBrowser/render/{id}`) keeps every
existing contract: `data-render-ready`, `data-render-error`, `window.__renderState` and
`window.__renderExport`. It adds one entry point.

## `window.__renderNavigate(url: string, nav: string): Promise<boolean>`

- **`url`:** a render address, path and query, as the service loads today, for example
  `/PathwayBrowser/render/R-HSA-123?layout=reaction&dark=true`. Anything that is not a
  render address is refused: the promise resolves `false` and the page is not moved.
- **`nav`:** an id the caller chooses, unique on this page.
- **What it does:**
  - navigates inside the app, without reloading;
  - destroys the current render component and constructs a new one, which reads the new
    address as a fresh page does;
  - resolves `true` once the navigation is accepted. That is not the figure being ready.
- **Readiness:** wait for `cr-render[data-render-nav="{nav}"]` that has
  `data-render-ready="true"` or `data-render-error`. Its `__renderState.nav` is `nav`.
  A host with another `nav`, or none, is a previous figure's.
- **Present** from the app's start, on the render routes only.

## `__renderState` additions

| Field   | Meaning                                                          |
| ------- | ---------------------------------------------------------------- |
| `nav`   | the `nav` this figure was navigated with; absent on a full load  |
| `build` | the site build drawing it (the service compares it, research R3) |
