import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { NavigationBarComponent } from './app/navigation-bar/navigation-bar.component';
import { appConfig } from './app/app.config';
import { InfoFooterComponent } from './app/info-footer/info-footer.component';

// Create the Angular application with standalone configuration
createApplication(appConfig).then((appRef) => {
  const websiteAngularElement = createCustomElement(AppComponent, {
    injector: appRef.injector,
  });

  const navigationBarElement = createCustomElement(NavigationBarComponent, {
    injector: appRef.injector,
  });

  const infoFooterElement = createCustomElement(InfoFooterComponent, {
    injector: appRef.injector,
  });

  customElements.define('website-angular', websiteAngularElement);
  customElements.define('app-navigation-bar', navigationBarElement);
  customElements.define('app-info-footer', infoFooterElement);
});
