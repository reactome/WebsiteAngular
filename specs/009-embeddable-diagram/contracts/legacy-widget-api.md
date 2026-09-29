# Contract: `window.Reactome.Diagram` (old-widget compatibility)

This reimplements the interface documented for the old diagram widget (https://reactome.org/dev/diagram/js), on top of `<reactome-diagram>`. It's defined **synchronously** by the classic loader, so hosts that poll `typeof Reactome` and then call `create` straight away keep working. That's AllianceGenome's `pathwayWidget.jsx`.

## Create

```js
var diagram = Reactome.Diagram.create({
  placeHolder: 'reactomePathwayHolder', // id of an existing element
  width: 1130,
  height: 600,
  proxyPrefix: '...', // accepted and ignored: no proxy is needed any more
});
```

`create` puts a `<reactome-diagram>` element of that size into the placeholder and returns the object below. Calls made before the element is ready are queued and applied in order.

## Methods

Each one maps to the v1 element:

| Old method                              | Element equivalent                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `loadDiagram(stId)`                     | `pathway = stId`                                                                      |
| `selectItem(stId)`                      | `select = stId`                                                                       |
| `resetSelection()`                      | `resetSelection()`                                                                    |
| `flagItems(term)`                       | `flag = term`                                                                         |
| `resetFlaggedItems()`                   | `resetFlag()`, which fires `onFlagsReset`                                             |
| `highlightItem(stId)`                   | Stands out the entity as hovering it would, without selecting it                      |
| `resetHighlight()`                      | Clears that                                                                           |
| `setAnalysisToken(token, resultFilter)` | `analysisToken = token`, `analysisResource = resultFilter.resource` (default `TOTAL`) |
| `resetAnalysis()`                       | `resetAnalysis()`, which fires `onAnalysisReset`                                      |
| `resize(width, height)`                 | Sets the element's size                                                               |

## Handlers

| Old registration           | Called with                                                              | From element event                          |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| `onDiagramLoaded(fn)`      | `fn(stId)`                                                               | `diagramloaded`                             |
| `onObjectSelected(fn)`     | `fn(obj)`, where `obj` is `{ stId, displayName, schemaClass }` or `null` | `entityselected`                            |
| `onObjectHovered(fn)`      | `fn(obj)`, same shape                                                    | `entityhovered`                             |
| `onFlagsReset(fn)`         | `fn()`                                                                   | `flagcleared`                               |
| `onAnalysisReset(fn)`      | `fn()`                                                                   | `analysiscleared`                           |
| `onCanvasNotSupported(fn)` | `fn()`                                                                   | `diagramerror` with `reason: 'unsupported'` |

Several handlers may be registered for each event; each registration adds one.
