import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import parseFrontmatter from '../utils/parseFrontmatter';

/**
 * Checks over the authored content tree that no single page's test would catch.
 *
 * The page component renders a file's frontmatter title as its heading, and the
 * importer that brought pages over from the old site wrote `title: Untitled`
 * when it found none -- so Digital Preservation went out headed "UNTITLED" and
 * nothing failed.
 */
const CONTENT = path.resolve(__dirname, '../../content');

function contentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return contentFiles(full);
    return /\.mdx?$/.test(entry.name) ? [full] : [];
  });
}

describe('authored content', () => {
  const files = contentFiles(CONTENT);

  it('finds the content tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('gives every page a real title', () => {
    const untitled = files
      .filter((file) => {
        const title = parseFrontmatter(fs.readFileSync(file, 'utf8')).frontmatter['title'];
        return typeof title !== 'string' || !title.trim() || /^untitled$/i.test(title.trim());
      })
      .map((file) => path.relative(CONTENT, file));
    expect(untitled).toEqual([]);
  });
});
