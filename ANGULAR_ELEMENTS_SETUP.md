# Angular Elements Setup for Standalone Components

This setup allows you to use the pathway-browser as a standalone web component.

## Structure

```
projects/
  pathway-browser/
    src/
      elements.ts          # Defines pathway-browser as custom element
      app/
        app.component.ts   # Standalone root component
        app.config.ts      # Application configuration
src/
  app/
    app.elements.ts        # Imports all custom elements
  main.ts                  # Bootstraps main app and loads elements
```

## How It Works

### 1. Child Application (pathway-browser)

The `elements.ts` file creates the custom element using standalone configuration:

```typescript
import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

createApplication(appConfig).then((appRef) => {
  const pathwayBrowserElement = createCustomElement(AppComponent, {
    injector: appRef.injector
  });
  customElements.define('pathway-browser', pathwayBrowserElement);
});
```

### 2. Parent Application

The `app.elements.ts` imports all child application elements:

```typescript
import '../projects/pathway-browser/src/elements';
```

### 3. Main Entry Point

The `main.ts` bootstraps the main application and loads custom elements:

```typescript
import './app/app.elements';
bootstrapApplication(AppComponent, appConfig);
```

## Building

### Build for Production

```bash
# Build with production settings
ng build --configuration production

# Build without output hashing (for easier integration)
ng build --configuration production --output-hashing none
```

### Build Individual Projects

```bash
# Build pathway-browser
ng build PathwayBrowser --configuration production

# Build main application
ng build reactome --configuration production
```

## Using the Custom Element

Once built, you can use the pathway-browser as a custom element in any HTML:

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Include the built scripts -->
  <script src="dist/reactome/main.js"></script>
</head>
<body>
  <!-- Use the custom element -->
  <pathway-browser></pathway-browser>
</body>
</html>
```

## Passing Data to Custom Elements

You can pass data through attributes or properties:

```html
<pathway-browser 
  pathway-id="R-HSA-123456"
  dark-mode="true">
</pathway-browser>
```

Or via JavaScript:

```javascript
const element = document.querySelector('pathway-browser');
element.pathwayId = 'R-HSA-123456';
```

## Notes

- The custom element approach works alongside the regular routing
- Both routing (`/PathwayBrowser`) and custom element (`<pathway-browser>`) work simultaneously
- All standalone component features (signals, inputs, etc.) are preserved
- The web component is fully encapsulated with its own dependencies
