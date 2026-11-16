import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import imageSize from '../../../utils/imageSize';
import { REACTOME_PARTNERS } from './partners';

// The page reserves each logo's box from these numbers before the file loads.
// A replaced logo with the old numbers would be drawn at the wrong shape.
describe('partner logos', () => {
  it.each(REACTOME_PARTNERS.map((p) => [p.name, p] as const))(
    "%s's recorded size is its file's",
    (_name, partner) => {
      const bytes = readFileSync(join(__dirname, '../../..', partner.logosrc));
      const size = imageSize(bytes);
      expect(size && [size.width, size.height]).toEqual(partner.logoSize);
    }
  );
});
