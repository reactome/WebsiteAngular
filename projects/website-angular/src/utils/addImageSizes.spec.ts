import { describe, expect, it } from 'vitest';
import addImageSizes from './addImageSizes';

const sizes: Record<string, [number, number]> = { '/uploads/a.png': [663, 540] };

describe('reserving space for a content image', () => {
  it('sets the measured size', () => {
    expect(addImageSizes('<img src="/uploads/a.png">', sizes)).toBe(
      '<img src="/uploads/a.png" width="663" height="540">'
    );
  });

  it('matches a src the page has already rewritten', () => {
    // `normalizeContentUrl` in page.component strips the leading slash before
    // this runs. Keying on the literal string made the transform inert: 114
    // images on the FIViz page, none given a size, while the page still looked
    // better because the browser had them cached from an earlier run. The
    // rendered markup said `withWidth: 0` and the geometry said "fixed".
    expect(addImageSizes('<img src="uploads/a.png" alt="">', sizes)).toContain('width="663"');
  });

  it('leaves alt text containing an angle bracket intact', () => {
    // Documentation is full of menu paths. `<img[^>]*>` truncates the tag at
    // the first `>` inside the alt text and inserts the width there.
    const out = addImageSizes('<img src="/uploads/a.png" alt="File > Export">', sizes);
    expect(out).toContain('alt="File > Export"');
    expect(out).toContain('width="663"');
  });

  it('keeps a self-closing tag self-closing', () => {
    expect(addImageSizes('<img src="/uploads/a.png" />', sizes)).toBe(
      '<img src="/uploads/a.png" width="663" height="540" />'
    );
  });

  it('does not overrule a size the author wrote', () => {
    const authored = '<img src="/uploads/a.png" width="100">';
    expect(addImageSizes(authored, sizes)).toBe(authored);
  });

  it('leaves an image it has no measurement for alone', () => {
    // Better than guessing: a wrong size reserves the wrong space, so the
    // reader gets a jump in the other direction and nobody suspects this.
    const unknown = '<img src="/uploads/elsewhere.png">';
    expect(addImageSizes(unknown, sizes)).toBe(unknown);
  });

  it('does nothing without a manifest, so older content still renders', () => {
    const html = '<img src="/uploads/a.png">';
    expect(addImageSizes(html, undefined)).toBe(html);
    expect(addImageSizes(html, {})).toBe(html);
  });

  it('survives a malformed src rather than failing the page', () => {
    // `decodeURIComponent('%')` throws.
    const broken = '<img src="/uploads/%">';
    expect(addImageSizes(broken, sizes)).toBe(broken);
  });
});
