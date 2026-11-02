/**
 * The release's files from a local folder, in place of the download site.
 *
 * The render page fetches a diagram's layout (`{release}/diagram/{id}.json` and
 * `.graph.json`) and an illustration (`{release}/ehld/{id}.svg`) from the
 * download site, as a reader's browser does. A reader's browser should: that is
 * what the site's CDN is for. A render should not: it is a server drawing in
 * bulk, and for a release step the release's files are not on the download site
 * until the release is published. So when a folder is given, every request the
 * page makes to the download site is answered from it, laid out as the site is
 * (`<folder>/98/diagram/R-HSA-69620.json`), and a file the folder lacks is a
 * 404 -- never a request to the site.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The download site, as the site's profiles name it (environments.ts, `S3`). */
export const DOWNLOAD_ORIGIN = 'https://download.reactome.org';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Whether a request is one the folder answers: anything on the download site. */
export function isDownload(url: URL): boolean {
  return url.origin === DOWNLOAD_ORIGIN;
}

/**
 * The answer to a download-site request from `root`: the file at the URL's
 * path beneath it, or a 404. A path that would leave the folder is a 404 too.
 */
export async function localAnswer(
  root: string,
  url: URL
): Promise<{ status: number; contentType: string; body: Buffer | string }> {
  const missing = { status: 404, contentType: 'text/plain', body: 'not in the local files' };
  const base = path.resolve(root);
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return missing;
  }
  const file = path.resolve(base, `.${relative}`);
  if (!file.startsWith(base + path.sep)) return missing;
  try {
    const body = await readFile(file);
    const contentType = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return { status: 200, contentType, body };
  } catch {
    return missing;
  }
}
