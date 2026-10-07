import { describe, expect, it } from 'vitest';
import imageSize from './imageSize';

/** A PNG header: signature, chunk length, IHDR, then width and height. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(10);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

/** JPEG with `padding` bytes of metadata before the start-of-frame segment. */
function jpeg(width: number, height: number, padding = 0): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (padding > 0) {
    const segment = Buffer.alloc(padding + 4);
    segment.writeUInt16BE(0xffe1, 0); // APP1, where EXIF lives
    segment.writeUInt16BE(padding + 2, 2);
    parts.push(segment);
  }
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(9, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  parts.push(frame);
  return Buffer.concat(parts);
}

describe('reading an image size from its own bytes', () => {
  it('reads a PNG', () => {
    expect(imageSize(png(1280, 720))).toEqual({ width: 1280, height: 720 });
  });

  it('reads a GIF, which is little-endian where PNG is not', () => {
    expect(imageSize(gif(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it('reads a JPEG whose frame sits at the start', () => {
    expect(imageSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads a JPEG with kilobytes of metadata before the frame', () => {
    // The reason the segments are walked rather than indexed: a photograph with
    // an EXIF thumbnail or a colour profile puts the frame several kilobytes in,
    // and a fixed offset would read two arbitrary bytes as a size.
    expect(imageSize(jpeg(640, 480, 4096))).toEqual({ width: 640, height: 480 });
  });

  it('reads an SVG viewBox', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18"></svg>');
    expect(imageSize(svg)).toEqual({ width: 24, height: 18 });
  });

  it('prefers the viewBox to a percentage width, which means nothing here', () => {
    // `width="100%"` is a share of a container this cannot see. Taking it
    // literally would reserve 100 by 100 pixels for a banner.
    const svg = Buffer.from('<svg width="100%" height="100%" viewBox="0 0 800 200"></svg>');
    expect(imageSize(svg)).toEqual({ width: 800, height: 200 });
  });

  it('falls back to SVG width and height attributes when there is no viewBox', () => {
    const svg = Buffer.from('<svg width="48px" height="48px"></svg>');
    expect(imageSize(svg)).toEqual({ width: 48, height: 48 });
  });

  it('returns null rather than guessing at something it does not know', () => {
    // The caller leaves that image alone. A wrong size is worse than none: it
    // reserves the wrong space, so the reader gets a jump in the other
    // direction and nobody suspects the manifest.
    expect(imageSize(Buffer.from('not an image at all'))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('does not mistake an SVG mentioned inside other text for one', () => {
    expect(imageSize(Buffer.from('a document about <svgomething> else'))).toBeNull();
  });
});
