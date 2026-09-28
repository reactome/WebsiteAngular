# Data model: Embeddable Reactome pathway diagram

There's no stored data. These are the in-memory objects and how they relate.

## Embedded diagram (one per `<reactome-diagram>`)

| Field                               | Source                                    | Rules                                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pathway`                           | attribute or property                     | Required. A stable id; a dbId is normalised to the stable id (constitution IV) before loading. Changing it resets `select` to null and keeps `flag` and `analysis`, as the Pathway Browser does on navigation. |
| `select`                            | attribute, property, or a visitor's click | Null, or an id present in the diagram. An id that isn't in the diagram is ignored, not an error.                                                                                                               |
| `flag`                              | attribute, property, or the legend        | Null or a term. Flagging follows the Pathway Browser's rules (same service).                                                                                                                                   |
| `analysisToken`, `analysisResource` | attribute or property                     | Null or a token. `resource` defaults to `TOTAL`.                                                                                                                                                               |
| `theme`                             | attribute                                 | `light` (default) or `dark`.                                                                                                                                                                                   |
| status                              | internal                                  | `loading` → `drawn` \| `error(not-found \| unavailable \| unsupported)`. A new `pathway` returns it to `loading`.                                                                                              |

Each element has its **own** injector with its own state: two elements never share `select`, `flag` or `analysis`.

**State transitions**:

- `loading` → `drawn` fires `diagramloaded`.
- `loading` → `error` fires `diagramerror` and shows the message.
- A visitor double-clicking a sub-pathway sets `pathway` to it: the new id, back to `loading`.

## Memory state (replaces URL-backed state inside the element)

It exposes the same signals the diagram reads (`pathwayId`, `select`, `flag`, `analysis`, `overlay`, `interactorScore`, …) and `navigateTo(id)`, which sets `pathwayId`, and nothing else. It never touches `location` or `history`.

## Old-interface diagram (from `Reactome.Diagram.create`)

A thin object that wraps one element: a queue of calls made before the element was ready, and lists of handlers per event. See [contracts/legacy-widget-api.md](contracts/legacy-widget-api.md).
