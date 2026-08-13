import { ScientificNumberPipe } from './scientific-number.pipe';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

describe('ScientificNumberPipe', () => {
  let pipe: ScientificNumberPipe;

  beforeEach(() => {
    // See safe.pipe.spec.ts -- DomSanitizer is an abstract platform token and
    // cannot be supplied via providers.
    pipe = new ScientificNumberPipe(TestBed.inject(DomSanitizer));
  });

  it('creates an instance', () => {
    expect(pipe).toBeTruthy();
  });
});
