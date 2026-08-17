import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Create the Angular application with standalone configuration
createApplication(appConfig).then((appRef) => {
  const pathwayBrowserElement = createCustomElement(AppComponent, {
    injector: appRef.injector
  });
  
  customElements.define('pathway-browser', pathwayBrowserElement);
})
  .catch((error) =>
    // Nothing registers the custom elements if this rejects, so the host
    // page renders empty tags with no clue why.
    console.error('Could not bootstrap Reactome custom elements', error)
  );
