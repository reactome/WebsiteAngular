# Contract: `<reactome-diagram>` element (v1)

The public interface partners code against. Anything not listed here isn't part of the contract.

## Loading

```html
<!-- Classic script: defines <reactome-diagram> and window.Reactome.Diagram -->
<script src="https://reactome.org/embed/diagram/v1/reactome-diagram.js"></script>
```

or, for partners who bundle ES modules:

```html
<script type="module" src="https://reactome.org/embed/diagram/v1/main.js"></script>
```

The classic loader adds the fonts and the stylesheet the element needs to the page's `<head>`. With the module form, the partner adds `https://reactome.org/embed/diagram/v1/styles.css` themselves.

## Attributes and properties

| Attribute           | Property           | Type                                                     | Meaning                                                                                                                   |
| ------------------- | ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pathway`           | `pathway`          | stable id (`R-HSA-…`; a dbId is accepted and normalised) | The pathway to show. Changing it loads the new pathway. Required.                                                         |
| `select`            | `select`           | stable id or null                                        | The entity selected and brought into view.                                                                                |
| `flag`              | `flag`             | text or null                                             | A term, such as a gene name or identifier, whose matching entities are flagged. Same rules as the Pathway Browser's flag. |
| `analysis-token`    | `analysisToken`    | analysis token or null                                   | Overlays that AnalysisService result. Reading only; nothing is submitted.                                                 |
| `analysis-resource` | `analysisResource` | string, default `TOTAL`                                  | The resource filter for the overlay.                                                                                      |
| `theme`             | `theme`            | `light` \| `dark`, default `light`                       | Colour scheme.                                                                                                            |

Setting a property is the same as setting its attribute. Removing the attribute, or setting the property to `null`, clears it.

**Size**: the element fills the box its host gives it. With no size, it takes 800 × 500 px.

## Methods

| Method                                               | Effect                                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `fit()`                                              | Fits the whole diagram in view.                       |
| `resetSelection()`, `resetFlag()`, `resetAnalysis()` | Clear that state, the same as removing the attribute. |

## Events

Each is a `CustomEvent`, dispatched on the element. They bubble and are composed, so they cross the shadow boundary.

| Event             | `detail`                                                                     | When                                                                |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `diagramloaded`   | `{ pathway: string }`                                                        | A pathway has finished drawing.                                     |
| `diagramerror`    | `{ pathway: string, reason: 'not-found' \| 'unavailable' \| 'unsupported' }` | It couldn't be shown. The element also shows a message.             |
| `entityselected`  | `{ id: string \| null, name: string \| null, schemaClass: string \| null }`  | The visitor selected (or deselected, with `id: null`) an entity.    |
| `entityhovered`   | same shape                                                                   | The visitor's pointer entered (or left, with `id: null`) an entity. |
| `flagcleared`     | `{}`                                                                         | The flag was cleared, from code or by the visitor.                  |
| `analysiscleared` | `{}`                                                                         | The analysis overlay was cleared.                                   |

## Guarantees

- It never reads or writes the page's `location`, `history`, `document.title`, `localStorage`, or `body` classes and styles.
- Styles don't cross the element's boundary in either direction: shadow DOM, and overlays kept inside it.
- Several elements on one page are independent.
- Removing the element tears it down; adding it back draws again.
- Loading the script more than once is harmless.
- All requests go to Reactome's public services, which allow cross-origin reads. No proxy is needed.
