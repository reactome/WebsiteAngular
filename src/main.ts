import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Import custom elements definitions
import './app/app.elements';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
