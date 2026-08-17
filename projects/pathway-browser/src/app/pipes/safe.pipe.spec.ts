import { SafePipe } from './safe.pipe';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

describe('SafePipe', () => {
  let pipe: SafePipe;

  beforeEach(() => {
    // The pipe takes its DomSanitizer through inject(), so it has to be built
    // inside an injection context; `new SafePipe(sanitizer)` throws NG0203.
    pipe = TestBed.runInInjectionContext(() => new SafePipe());
  });

  it('creates an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('marks html as trusted so it survives sanitisation', () => {
    const safe = pipe.transform('<b>bold</b>', 'html');
    expect(TestBed.inject(DomSanitizer).sanitize(1 /* SecurityContext.HTML */, safe)).toContain('<b>bold</b>');
  });
});
