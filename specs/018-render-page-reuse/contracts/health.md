# Contract: the render service's health answer

Every field `/health` answers today stays as it is. With `RENDER_REUSE` on, it adds:

| Field      | Type                                                 | Meaning                                                   |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `reuse`    | `boolean`                                            | whether held pages are used                               |
| `pages`    | `number`                                             | pages held now                                            |
| `reused`   | `number`                                             | figures drawn on a held page since start                  |
| `site`     | `string`                                             | the site build last read from `RENDER_BASE` (research R3) |
| `replaced` | `{ failure, count, memory, build, browser: number }` | pages closed since start, by reason (data-model)          |

With `RENDER_REUSE=off`, `reuse` is `false` and the other four are absent.

**Settings** (environment, read at start):

| Setting               | Default           | Meaning                                                                               |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `RENDER_REUSE`        | on (after SC-003) | `off`: a fresh page and context per figure                                            |
| `RENDER_REUSE_MAX`    | 200 (research R4) | figures a page draws before it is replaced                                            |
| `RENDER_REUSE_MEMORY` | 0.5 (research R4) | share of the container's memory limit above which a finished page is closed, not held |
