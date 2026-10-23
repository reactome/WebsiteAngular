import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadFormat, DownloadService, dataUrlToBlob } from './download.service';

// A picture the page makes -- an illustration, the genome-wide view -- is
// saved through this. As a data: URL it is the whole file in the link, and
// Chrome follows no link over 2 MB: a large illustration's PNG failed as
// "Site wasn't available" while its smaller formats saved.
describe('DownloadService.export', () => {
  let clicked: string[];
  let made: Blob[];

  beforeEach(() => {
    clicked = [];
    made = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.href);
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        made.push(blob);
        return `blob:test/${made.length}`;
      },
      revokeObjectURL: vi.fn(),
    });
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves a data: URL through a blob: URL, whatever its size', () => {
    const big = `data:image/png;base64,${btoa('x'.repeat(3 * 1024 * 1024))}`;
    TestBed.inject(DownloadService).export(big, DownloadFormat.PNG, 'R-HSA-913531');
    expect(clicked).toEqual(['blob:test/1']);
    expect([made[0]?.type, made[0]?.size]).toEqual(['image/png', 3 * 1024 * 1024]);
  });

  it('saves a Blob through a blob: URL, and lets it go afterwards', () => {
    vi.useFakeTimers();
    const picture = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/jpeg' });
    TestBed.inject(DownloadService).export(picture, DownloadFormat.JPEG, 'R-HSA-913531');
    expect(clicked).toEqual(['blob:test/1']);
    expect(made).toEqual([picture]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    vi.useRealTimers();
  });

  it('leaves a blob: URL or an address as it is', () => {
    TestBed.inject(DownloadService).export('blob:already/1', DownloadFormat.SVG, 'x');
    expect(clicked).toEqual(['blob:already/1']);
    expect(made).toEqual([]);
  });
});

describe('dataUrlToBlob', () => {
  it('decodes base64 and plain data, keeping the type', async () => {
    const png = dataUrlToBlob(`data:image/png;base64,${btoa('\u0001\u0002ÿ')}`);
    expect([png.type, [...new Uint8Array(await png.arrayBuffer())]]).toEqual([
      'image/png',
      [1, 2, 255],
    ]);
    const svg = dataUrlToBlob('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
    expect([svg.type, await svg.text()]).toEqual(['image/svg+xml', '<svg/>']);
  });
});
