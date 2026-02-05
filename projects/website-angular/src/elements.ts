import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Create the Angular application with standalone configuration
createApplication(appConfig).then((appRef) => {
  const websiteAngularElement = createCustomElement(AppComponent, {
    injector: appRef.injector
  });
  
  customElements.define('website-angular', websiteAngularElement);
});
