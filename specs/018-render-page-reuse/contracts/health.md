# Contract: the render service's health answer

Every field `/health` answers today stays as it is. With `RENDER_REUSE` on, it adds:

| Field      | Type                                                 | Meaning                                                   |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `reuse`    | `boolean`                                            | whether held pages are used                               |
| `pages`    | `number`                                             | pages held now                                            |
| `reused`   | `number`                                             | figures drawn on a held page since start                  |
| `site`     | `string \| null`                                     | the site build last read from `RENDER_BASE` (research R3) |
| `replaced` | `{ failure, count, memory, build, browser: number }` | pages closed since start, by reason (data-model)          |

With `RENDER_REUSE=off`, `reuse` is `false` and the other four are absent, not zero: there
are no pages to count, and an absent field cannot be mistaken for a reuse run that drew
nothing.

`site` is null before the site has been read, and while the last read failed (then no
page is replaced for its build). Asking `/health` starts a read, at most once a minute
like any other, and never waits for it: the first answer after a start may be null.

The type is `RenderHealth` in `projects/contract/render.ts`; the reasons are
`RenderReplacement` there, which `pages.ts` counts by.

**Settings** (environment, read at start):

| Setting               | Default           | Meaning                                                                                                                                                                    |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RENDER_REUSE`        | on (after SC-003) | `off`: a fresh page and context per figure                                                                                                                                 |
| `RENDER_REUSE_MAX`    | 200 (research R4) | figures a page draws before it is replaced                                                                                                                                 |
| `RENDER_REUSE_MEMORY` | 0.5 (research R4) | share of the container's memory limit above which a finished page is closed, not held: one per round of figures, and every one a quarter of the way on to the limit (T015) |
