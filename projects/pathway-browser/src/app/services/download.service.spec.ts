import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadFormat,
  DownloadService,
  DownloadTarget,
  FIGURE_BUSY,
  FIGURE_DEADLINE_MS,
  FIGURE_LOADING,
  FIGURE_NONE,
  FIGURE_UNAVAILABLE,
  dataUrlToBlob,
  defaultDownloadOptions,
} from './download.service';

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
    vi.useRealTimers();
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
  });

  it('leaves a blob: URL or an address as it is, and does not revoke it', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(DownloadService);
    service.export('blob:already/1', DownloadFormat.SVG, 'x');
    service.export('/RenderService/render/R-HSA-69620.pptx', DownloadFormat.PPTX, 'x');
    vi.advanceTimersByTime(60_000);
    expect(clicked).toEqual([
      'blob:already/1',
      `${location.origin}/RenderService/render/R-HSA-69620.pptx`,
    ]);
    expect(made).toEqual([]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
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

// A figure drawn in the page takes seconds for a large illustration, and the
// button has to say so from the click until the file is saved or has failed.
describe('DownloadService.working', () => {
  const drawer = {};
  let service: DownloadService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({});
    service = TestBed.inject(DownloadService);
    service.figureState(drawer, DownloadTarget.DIAGRAM, 'ready');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const request = (format = DownloadFormat.PNG) => {
    service.requestDownload(DownloadTarget.DIAGRAM, format);
    const made = service.downloadRequest();
    if (!made) throw new Error('the request was refused');
    return made.id;
  };

  it('runs from the request until the figure is saved, not until it is picked up', () => {
    const id = request();
    expect(service.working()).toEqual({
      id,
      target: DownloadTarget.DIAGRAM,
      format: DownloadFormat.PNG,
      animated: false,
    });
    expect(service.working(), 'picking the request up is not finishing it').not.toBeNull();
    service.finished(id);
    expect([service.working(), service.downloadRequest()]).toEqual([null, null]);
  });

  it('ends with the reason when the figure fails', () => {
    const id = request(DownloadFormat.JPEG);
    service.failed(new Error('this illustration embeds HTML'), 'EHLD image export failed', id);
    expect([service.working(), service.failure()]).toEqual([null, 'this illustration embeds HTML']);
  });

  it('hands the request to the drawer that was ready, and no other', () => {
    request();
    expect(service.downloadRequest()?.owner).toBe(drawer);
  });

  it('says nothing more to the second click of a double-click', () => {
    request(DownloadFormat.PNG);
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.PNG);
    expect(service.failure()).toBeNull();
  });

  it('takes one figure at a time, and says so', () => {
    const id = request(DownloadFormat.PNG);
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.JPEG);
    expect(service.downloadRequest()?.format).toBe(DownloadFormat.PNG);
    expect(service.working()?.format).toBe(DownloadFormat.PNG);
    expect(service.failure()).toBe(FIGURE_BUSY);
    service.finished(id);
    expect(service.failure(), 'the notice goes once the figure has saved').toBeNull();
  });

  it('says at once when the figure is still loading, or could not be shown', () => {
    service.figureState(drawer, DownloadTarget.DIAGRAM, 'loading');
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.PNG);
    expect([service.working(), service.downloadRequest(), service.failure()]).toEqual([
      null,
      null,
      FIGURE_LOADING,
    ]);
    service.figureState(drawer, DownloadTarget.DIAGRAM, 'failed');
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.PNG);
    expect(service.failure()).toBe(FIGURE_UNAVAILABLE);
    service.figureGone(drawer);
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.PNG);
    expect([service.working(), service.failure()]).toEqual([null, FIGURE_NONE]);
  });

  it("forgets a drawer's word only if no other drawer has spoken since", () => {
    const next = {};
    service.figureState(next, DownloadTarget.DIAGRAM, 'ready');
    service.figureGone(drawer);
    expect(service.figure()?.owner).toBe(next);
  });

  it('gives up, and says so, when nothing makes the figure', () => {
    request();
    vi.advanceTimersByTime(FIGURE_DEADLINE_MS - 1);
    expect(service.working()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(service.working()).toBeNull();
    expect(service.failure()).toMatch(/taking too long/);
    expect(service.downloadRequest(), 'nor is it drawn later').toBeNull();
  });

  it('does not time out a figure that was saved', () => {
    const id = request(DownloadFormat.SVG);
    // Saved partway through: the first figure's deadline would fall inside
    // the second's if it were left running.
    vi.advanceTimersByTime(10_000);
    service.finished(id);
    request(DownloadFormat.PNG);
    vi.advanceTimersByTime(FIGURE_DEADLINE_MS - 1);
    expect(service.failure()).toBeNull();
  });

  it('lets a late ending of a request given up on touch nothing later', () => {
    const first = request(DownloadFormat.SVG);
    vi.advanceTimersByTime(FIGURE_DEADLINE_MS);
    const second = request(DownloadFormat.PNG);
    service.finished(first);
    expect(service.downloadRequest()?.id, 'the later request still reaches its drawer').toBe(
      second
    );
    service.failed(new Error('late'), 'late', first);
    expect(service.working()?.id).toBe(second);
    expect(service.downloadRequest()?.id).toBe(second);
    expect(service.failure()).toBeNull();
  });

  it('tells an animated SVG from a still one', () => {
    service.requestDownload(DownloadTarget.DIAGRAM, DownloadFormat.SVG, {
      ...defaultDownloadOptions,
      animate: true,
    });
    expect(service.working()?.animated).toBe(true);
  });
});
