// No zone.js: the application runs zoneless, so the tests do too. TestBed is
// told explicitly, because without a change-detection provider it would fall
// back to expecting zone.js to be loaded.
import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
  providers: [provideZonelessChangeDetection()],
});
