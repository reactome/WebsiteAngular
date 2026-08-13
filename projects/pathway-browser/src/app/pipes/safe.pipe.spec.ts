import { SafePipe } from './safe.pipe';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

describe('SafePipe', () => {
  let pipe: SafePipe;

  beforeEach(() => {
    // DomSanitizer can't be listed as a provider -- it's an abstract token the
    // platform supplies, and providing the class directly made Angular try to
    // construct it, failing with invalidFactoryDep. Inject the real one and
    // build the pipe with it.
    const sanitizer = TestBed.inject(DomSanitizer);
    pipe = new SafePipe(sanitizer);
  });

  it('creates an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('marks html as trusted so it survives sanitisation', () => {
    const safe = pipe.transform('<b>bold</b>', 'html');
    expect(TestBed.inject(DomSanitizer).sanitize(1 /* SecurityContext.HTML */, safe)).toContain('<b>bold</b>');
  });
});
