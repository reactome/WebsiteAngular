import { ScientificNumberPipe } from './scientific-number.pipe';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

describe('ScientificNumberPipe', () => {
  let pipe: ScientificNumberPipe;

  beforeEach(() => {
    // Built inside an injection context: the pipe takes its DomSanitizer
    // through inject() rather than the constructor.
    pipe = TestBed.runInInjectionContext(() => new ScientificNumberPipe());
  });

  it('creates an instance', () => {
    expect(pipe).toBeTruthy();
  });
});
