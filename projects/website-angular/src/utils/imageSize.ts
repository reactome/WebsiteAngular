/**
 * The intrinsic size of an image, read from its own bytes.
 *
 * Why this exists rather than a dependency: four formats cover every image the
 * content carries -- 671 PNG, 33 SVG, 20 GIF, 26 JPEG -- and each states its
 * dimensions in a header that is a few bytes to read. A package would be a
 * lockfile entry and a supply-chain surface for sixty lines.
 *
 * Returns null for anything it does not recognise, and the caller leaves that
 * image alone rather than guessing. A wrong size reserves the wrong space,
 * which is worse than reserving none: the reader gets a jump in the opposite
 * direction and no one suspects the manifest.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export default function imageSize(bytes: Buffer): ImageSize | null {
  return png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? svg(bytes);
}

/** `\x89PNG\r\n\x1a\n`, then an IHDR chunk whose first two fields are the size. */
function png(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** `GIF87a`/`GIF89a`, then the logical screen size, little-endian. */
function gif(bytes: Buffer): ImageSize | null {
  if (bytes.length < 10) return null;
  if (bytes.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * JPEG keeps its size in a start-of-frame segment, and where that segment sits
 * depends on how much metadata precedes it -- so the segments have to be walked
 * rather than indexed. EXIF thumbnails and colour profiles routinely push it
 * several kilobytes in.
 */
function jpeg(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;

  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null; // not where a segment should start
    const marker = bytes[at + 1];
    // The start-of-frame markers, minus C4, C8 and CC, which are Huffman
    // tables and arithmetic coding conditioning rather than frames.
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/**
 * SVG states a size in attributes, a viewBox, or neither.
 *
 * `width="100%"` is common and means nothing here: a percentage is a share of
 * something this cannot see. Where a viewBox exists its last two numbers are
 * the intrinsic ratio, which is what reserves the right space.
 */
function svg(bytes: Buffer): ImageSize | null {
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 4096));
  if (!/<svg[\s>]/i.test(head)) return null;

  const box = /viewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(head);
  if (box) {
    const width = Number(box[1]);
    const height = Number(box[2]);
    if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
  }

  const attribute = (name: string): number | null => {
    const found = new RegExp(`<svg[^>]*\\s${name}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i').exec(head);
    return found ? Number(found[1]) : null;
  };
  const width = attribute('width');
  const height = attribute('height');
  if (width && height) return { width: Math.round(width), height: Math.round(height) };

  return null;
}
