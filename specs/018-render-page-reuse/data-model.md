# Data model: Render page reuse

## Held page

A browser page in its own context with the render page loaded, kept by the render service
between figures.

| Field     | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| `build`   | the site build the page loaded, from its `__renderState` |
| `figures` | figures drawn on it so far                               |
| `busy`    | whether a figure is being drawn on it                    |

**States:**

- **new**: no figure drawn yet. The first figure is a full load.
- **held**: idle between figures.
- **drawing**: a figure is being drawn, using `__renderNavigate`.
- **replaced**: closed with its context.

A page goes from drawing back to held only when all of these hold:

- the figure succeeded, with no problem in the page (an uncaught error, or a release
  file left unanswered; console errors alone do not count, T015);
- `figures` is below `RENDER_REUSE_MAX`;
- the service's container uses at most `RENDER_REUSE_MEMORY` of its memory limit
  (research R4: a renderer's memory is mostly outside its JavaScript heap), or, up to a
  quarter of the way from that to the limit, this page has drawn only one figure or a
  page was replaced for memory within the last `RENDER_CONCURRENCY` figures (T015);
- `build` is the site's current build.

Otherwise the page is replaced.

**Rules:**

- At most `RENDER_CONCURRENCY` pages are held.
- A page is never shared by two figures at once.

## Replacement

Why a held page was closed. Counted in the health answer.

| Reason    | When                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failure` | the figure threw, timed out or reported a problem in the page (not a console error alone), or the page crashed while held                                                                                                                       |
| `count`   | `figures` reached `RENDER_REUSE_MAX`                                                                                                                                                                                                            |
| `memory`  | the container passed `RENDER_REUSE_MEMORY` of its limit, and the page had drawn more than one figure and none was replaced for memory within the last `RENDER_CONCURRENCY` figures; past a quarter of the way from there to the limit, any page |
| `build`   | the site's build changed                                                                                                                                                                                                                        |
| `browser` | the browser restarted; every held page goes                                                                                                                                                                                                     |
