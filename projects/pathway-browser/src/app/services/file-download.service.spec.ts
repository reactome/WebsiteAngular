/**
 * What the user is told while a file is being made, and what happens when it
 * cannot be.
 *
 * A diagram's PowerPoint is rendered on demand and takes seconds. Handed to the
 * browser as `<a href download>` that time is silent, and a failure is *saved*:
 * the render service answers a bad id with `404 {"error":"no such pathway"}`
 * and the browser writes those bytes into a `.pptx`, which PowerPoint then
 * offers to repair.
 *
 * The phase machine and the header parsing are pure, so the states a user sees
 * are checked here without a browser or a render behind them.
 */
import { describe, expect, it } from 'vitest';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import {
  describeProgress,
  describeSize,
  failureKind,
  filenameFrom,
  filenameFromUrl,
  messageFrom,
  nextPhase,
} from './file-download.service';

describe('the phase a download reports', () => {
  it('says it is preparing as soon as the request goes out', () => {
    expect(nextPhase({ type: HttpEventType.Sent })).toEqual({ status: 'preparing' });
  });

  it('shows a fraction only once bytes are actually arriving', () => {
    // The server sends nothing until the file exists, so there is no honest
    // fraction to show before then -- which is why "preparing" is its own state
    // rather than 0%.
    expect(nextPhase({ type: HttpEventType.DownloadProgress, loaded: 512, total: 2048 })).toEqual({
      status: 'transferring',
      received: 512,
      total: 2048,
    });
  });

  it('reports no total when the server did not give one', () => {
    expect(nextPhase({ type: HttpEventType.DownloadProgress, loaded: 512 })).toEqual({
      status: 'transferring',
      received: 512,
      total: null,
    });
    // A zero total is not a total.
    expect(nextPhase({ type: HttpEventType.DownloadProgress, loaded: 1, total: 0 })).toEqual({
      status: 'transferring',
      received: 1,
      total: null,
    });
  });

  it('is saved only on a response, and carries what arrived', () => {
    const response = new HttpResponse({ body: new Blob(['x'.repeat(64)]), status: 200 });
    expect(nextPhase(response)).toEqual({ status: 'saved', bytes: 64 });
  });

  it('ignores the events that say nothing about progress', () => {
    expect(nextPhase({ type: HttpEventType.ResponseHeader } as never)).toBeNull();
    expect(nextPhase({ type: HttpEventType.User } as never)).toBeNull();
  });
});

describe('what the user is told when it fails', () => {
  it('shows the reason the server gave', () => {
    // This is the case that used to be saved as a .pptx.
    expect(messageFrom(404, '{"error":"no such pathway: R-HSA-000000"}')).toBe(
      'no such pathway: R-HSA-000000'
    );
    expect(messageFrom(500, '{"message":"the renderer fell over"}')).toBe('the renderer fell over');
  });

  it('falls back to something a person can act on', () => {
    expect(messageFrom(404, null)).toMatch(/nothing to download/);
    expect(messageFrom(503, '')).toMatch(/busy/);
    expect(messageFrom(0, null)).toMatch(/interrupted/);
    expect(messageFrom(418, null)).toMatch(/418/);
  });

  it('does not put a page of HTML in front of the user', () => {
    // A proxy or a login wall answers with a document, not a sentence.
    const html = '<!doctype html><html><body>Gateway Timeout</body></html>';
    expect(messageFrom(504, html)).not.toContain('<');
    expect(messageFrom(504, html)).toMatch(/504/);
  });

  it('survives a body that claims to be JSON and is not', () => {
    expect(messageFrom(500, '{ this is not json')).toMatch(/500|this is not json/);
  });
});

describe('the name the file is saved under', () => {
  it('takes the name the server asked for', () => {
    expect(filenameFrom('attachment; filename="R-HSA-109606.pptx"', 'fallback.bin')).toBe(
      'R-HSA-109606.pptx'
    );
  });

  it('copes with an unquoted or encoded name', () => {
    expect(filenameFrom('attachment; filename=genome-wide.gif', 'x')).toBe('genome-wide.gif');
    expect(filenameFrom("attachment; filename*=UTF-8''R-HSA-1%20copy.svg", 'x')).toBe(
      'R-HSA-1 copy.svg'
    );
  });

  it('falls back when the server said nothing', () => {
    expect(filenameFrom(null, 'R-HSA-109606.pptx')).toBe('R-HSA-109606.pptx');
    expect(filenameFrom('attachment', 'R-HSA-109606.pptx')).toBe('R-HSA-109606.pptx');
  });

  it('derives a name from the URL, without its query', () => {
    // The figure URLs carry a token and a view, and none of that belongs in a
    // filename.
    expect(
      filenameFromUrl('https://reactome.org/RenderService/render/R-HSA-109606.pptx?token=abc')
    ).toBe('R-HSA-109606.pptx');
    expect(filenameFromUrl('https://example.org/RenderService/render/')).toBe('download');
  });
});

describe('a header parser that has to hold up', () => {
  it('reads the header the render service actually sends', () => {
    // Copied from a live response rather than invented.
    const header = 'attachment; filename="R-HSA-1640170.pptx"';
    expect(filenameFrom(header, 'x')).toBe('R-HSA-1640170.pptx');
  });

  it('falls back rather than inventing a name out of punctuation', () => {
    // `filename=""` read literally names the file `""`. Truthy is not the test.
    for (const header of ['attachment; filename=""', 'attachment; filename=', 'inline']) {
      expect(filenameFrom(header, 'safe.pptx'), header).toBe('safe.pptx');
    }
  });
});

describe('telling a refusal apart from never arriving', () => {
  it('treats a real status as a real answer', () => {
    // The server spoke. Show what it said, and save nothing.
    for (const status of [400, 404, 500, 503]) {
      expect(failureKind(status), String(status)).toBe('refused');
    }
  });

  it('treats status 0 as a request that never happened', () => {
    // CORS, offline, an extension. The browser can still fetch the file, and
    // the published artefact needs that: it is served from one origin and asks
    // another for its downloads, and /RenderService sent no
    // Access-Control-Allow-Origin, so the page's own fetch was blocked outright
    // where the old plain link had worked.
    expect(failureKind(0)).toBe('unreachable');
  });
});

describe('what a link says while it works', () => {
  it('shows a percentage only when the total is known', () => {
    expect(describeProgress({ status: 'transferring', received: 512, total: 2048 })).toBe('25%');
  });

  it('shows how much has arrived when nobody said how much to expect', () => {
    // The content service's exporters send no Content-Length: an 807KB SBML and
    // a 2MB PDF both arrive over eight seconds without one. "62%" would be a
    // number we made up.
    expect(describeProgress({ status: 'transferring', received: 1_258_291, total: null })).toBe(
      '1.2 MB'
    );
    expect(describeProgress({ status: 'transferring', received: 14_486, total: null })).toBe(
      '14 KB'
    );
  });

  it('never claims to be finished before it is', () => {
    // 100% next to a file that has not been saved is a lie; the last percent
    // belongs to the save.
    expect(describeProgress({ status: 'transferring', received: 2048, total: 2048 })).toBe('99%');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeProgress({ status: 'idle' })).toBeNull();
    expect(describeProgress({ status: 'saved', bytes: 10 })).toBeNull();
    expect(describeProgress({ status: 'handed-off' })).toBeNull();
  });

  it('rounds sizes the way a person reads them', () => {
    expect(describeSize(0)).toBe('0 B');
    expect(describeSize(999)).toBe('999 B');
    expect(describeSize(1024)).toBe('1 KB');
    expect(describeSize(807_164)).toBe('788 KB');
    expect(describeSize(2_074_132)).toBe('2.0 MB');
  });
});
