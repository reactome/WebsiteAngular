import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { NavigationBarComponent } from './app/navigation-bar/navigation-bar.component';
import { appConfig } from './app/app.config';
import { copyrightFooterComponent } from './app/copyright-footer/copyright-footer.component';

// Create the Angular application with standalone configuration
createApplication(appConfig).then((appRef) => {
  const websiteAngularElement = createCustomElement(AppComponent, {
    injector: appRef.injector,
  });

  const navigationBarElement = createCustomElement(NavigationBarComponent, {
    injector: appRef.injector,
  });

  const copyrightFooterElement = createCustomElement(copyrightFooterComponent, {
    injector: appRef.injector,
  });

  customElements.define('website-angular', websiteAngularElement);
  customElements.define('app-reactome-header', navigationBarElement);
  customElements.define('app-reactome-footer', copyrightFooterElement);
});
