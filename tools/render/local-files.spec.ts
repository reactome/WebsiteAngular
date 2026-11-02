import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOWNLOAD_ORIGIN, isDownload, localAnswer } from './local-files.ts';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'render-files-'));
  await mkdir(path.join(root, '98', 'diagram'), { recursive: true });
  await mkdir(path.join(root, '98', 'ehld'), { recursive: true });
  await writeFile(path.join(root, '98', 'diagram', 'R-HSA-1.json'), '{"nodes":[]}');
  await writeFile(path.join(root, '98', 'ehld', 'R-HSA-2.svg'), '<svg/>');
  await writeFile(path.join(root, 'outside.txt'), 'not under 98');
  // A sibling whose name starts with the folder's: `98x` is not inside `98`.
  await mkdir(path.join(root, '98x'));
  await writeFile(path.join(root, '98x', 'f.txt'), 'a sibling');
  // A link inside the folder to a file outside it.
  await symlink(path.join(root, 'outside.txt'), path.join(root, '98', 'link.txt'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const at = (p: string) => new URL(`${DOWNLOAD_ORIGIN}${p}`);

describe('the download site from a local folder', () => {
  it('answers only requests to the download site', () => {
    expect(isDownload(at('/98/diagram/R-HSA-1.json'))).toBe(true);
    expect(isDownload(new URL('http://site/ContentService/data/database/version'))).toBe(false);
    expect(isDownload(new URL('https://download.reactome.org.example/98/x'))).toBe(false);
  });

  it('serves a diagram and an illustration by their path, with their types', async () => {
    const diagram = await localAnswer(root, at('/98/diagram/R-HSA-1.json?v=1'));
    expect(diagram).toMatchObject({ status: 200, contentType: 'application/json' });
    expect(String(diagram.body)).toBe('{"nodes":[]}');
    const ehld = await localAnswer(root, at('/98/ehld/R-HSA-2.svg'));
    expect(ehld).toMatchObject({ status: 200, contentType: 'image/svg+xml' });
  });

  it('answers 404 for a file the folder lacks, rather than asking the site', async () => {
    expect((await localAnswer(root, at('/98/diagram/R-HSA-3.json'))).status).toBe(404);
    expect((await localAnswer(root, at('/98/diagram/'))).status).toBe(404);
  });

  it('never reads outside the folder', async () => {
    const sibling = path.basename(root);
    for (const escape of [
      '/98/../../outside.txt',
      '/%2e%2e/outside.txt',
      `/../${sibling}/outside.txt`,
      '/%2e%2e%2f%2e%2e%2fetc/passwd',
      // An encoded slash survives the URL's own normalising and decodes to a
      // step out of the folder, to a file that exists.
      '/%2e%2e%2foutside.txt',
      '/%2e%2e%2f98x%2ff.txt',
      '/link.txt',
      '/%E0%A4%A',
    ]) {
      expect((await localAnswer(path.join(root, '98'), at(escape))).status, escape).toBe(404);
    }
  });
});
