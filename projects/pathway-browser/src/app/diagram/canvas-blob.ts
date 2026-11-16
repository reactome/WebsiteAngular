/**
 * A canvas's image, as a Blob.
 *
 * The browser gives no blob for a canvas it cannot encode: one with no width
 * or height (a merged size worked out from an empty layer's box is NaN, which
 * sets 0), or one larger than it will allocate. That is an error, not a null
 * to hand on as the image to download.
 */
export function canvasBlob(
  canvas: HTMLCanvasElement,
  format: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(`The image could not be made (${canvas.width}×${canvas.height}).`)),
      format,
      quality
    )
  );
}
