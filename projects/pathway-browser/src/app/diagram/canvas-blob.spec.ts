import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasBlob } from './canvas-blob';

/** A canvas whose toBlob hands back what the browser would. */
function canvasGiving(blob: Blob | null) {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(blob));
  return canvas;
}

describe('canvasBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives the canvas's image", async () => {
    const image = new Blob(['png'], { type: 'image/png' });
    await expect(canvasBlob(canvasGiving(image), 'image/png')).resolves.toBe(image);
  });

  it('passes the format and quality on', async () => {
    const canvas = canvasGiving(new Blob([]));
    await canvasBlob(canvas, 'image/jpeg', 0.9);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
  });

  it('fails, rather than giving null, when the browser makes no image', async () => {
    const canvas = canvasGiving(null);
    canvas.width = 0;
    await expect(canvasBlob(canvas, 'image/png')).rejects.toThrow(
      'The image could not be made (0×150).'
    );
  });
});
