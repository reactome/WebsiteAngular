# Contract: `<reactome-diagram>` element (v1)

The public interface partners code against. Anything not listed here isn't part of the contract.

## Loading

```html
<!-- Classic script: defines <reactome-diagram> (and, from Story 3, window.Reactome.Diagram) -->
<script src="https://reactome.org/embed/diagram/v1/reactome-diagram.js"></script>
```

or, for partners who bundle ES modules:

```html
<script type="module" src="https://reactome.org/embed/diagram/v1/main.js"></script>
```

The element carries its own styles, inside its shadow root. What it cannot carry is fonts: a shadow root ignores `@font-face`, so they have to be registered on the page. The classic loader adds them to the page's `<head>`. With the module form, the partner adds them themselves:

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap"
/>
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
/>
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" />
```

Without them the diagram still works, in fallback fonts and with its icons as words.

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

- It never reads or writes the page's `location`, `history`, `document.title`, `localStorage`, or `body` classes and styles, and defines no globals of its own on `window`.
- It adds nothing to the page's `<head>` beyond the loader's font links and script, with two exceptions from libraries it uses, neither of which can apply to the partner's elements: cytoscape's rule for its own container class (`style#__________cytoscape_stylesheet`), and empty `@media … { body {} }` rules from the CDK's breakpoint observer, a WebKit workaround.
- Styles don't cross the element's boundary in either direction: shadow DOM, and overlays kept inside it.
- Several elements on one page are independent.
- Removing the element tears it down; adding it back draws again. Its diagram lives in its own shadow root, so the partner's `children`, `innerHTML` and selectors don't see it, and a copy of the element does not copy it.
- Loading the script more than once is harmless, and so is loading both the classic loader and the module on one page.
- A property set before the script has loaded is taken when it does.
- All requests go to Reactome's public services, which allow cross-origin reads. No proxy is needed.
