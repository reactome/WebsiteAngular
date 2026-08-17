import { describe, expect, it } from 'vitest';
import { IncludeRefPipe } from './include-ref.pipe';
import type { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import type { LiteratureReference } from '../model/graph/publication/literature-reference.model';

// This spec previously imported the pipe and asserted nothing -- both lines of
// its body were commented out -- so it passed without exercising anything. The
// pipe turns author-year citations in summation text into links, which is worth
// covering: it builds regular expressions from curator-entered names.
//
// The sanitizer is stubbed to return the HTML unchanged so the linking itself
// can be asserted rather than a SafeHtml wrapper.
const sanitizer = {
  bypassSecurityTrustHtml: (value: string) => value as unknown as SafeHtml,
} as DomSanitizer;

const reference = (over: Partial<LiteratureReference> = {}) =>
  ({
    url: 'https://example.org/paper',
    year: 2005,
    author: [{ surname: 'Smith', initial: 'A' }],
    ...over,
  }) as LiteratureReference;

describe('IncludeRefPipe', () => {
  const pipe = new IncludeRefPipe(sanitizer);

  it('links a single-author citation', () => {
    const out = pipe.transform('as shown by Smith A. 2005 in vitro', [reference()]);
    expect(out).toContain('<a href="https://example.org/paper">Smith A. 2005</a>');
  });

  it('links an "et al" citation', () => {
    const out = pipe.transform('Smith A. et al, 2005 reported', [reference()]);
    expect(out).toContain('<a href="https://example.org/paper">');
    expect(out).toContain('et al');
  });

  it('links a two-author citation joined by "and"', () => {
    const out = pipe.transform('Smith A. and Jones B. 2005 found', [
      reference({
        author: [
          { surname: 'Smith', initial: 'A' },
          { surname: 'Jones', initial: 'B' },
        ],
      } as Partial<LiteratureReference>),
    ]);
    expect(out).toContain('<a href="https://example.org/paper">Smith A. and Jones B. 2005</a>');
  });

  it('leaves text alone when nothing matches', () => {
    expect(pipe.transform('no citations here', [reference()])).toBe('no citations here');
  });

  it('ignores references without a url', () => {
    const out = pipe.transform('Smith A. 2005', [reference({ url: undefined })]);
    expect(out).toBe('Smith A. 2005');
  });
});
