/**
 * Compiles the authored CMS content (.mdx) into plain JSON for the browser.
 *
 * Why:
 *   The app used to fetch raw .mdx over HTTP and parse the YAML frontmatter
 *   client-side. That is not how TinaCMS content is normally consumed -- the
 *   standard integration queries Tina's GraphQL API and receives structured
 *   JSON. It also broke on Angular 20+: the dev server's assets middleware
 *   serves extensionless/JS/TS/CSS itself and hands everything else to vite,
 *   which treats .mdx as compile-to-JS source and fails with "invalid JS
 *   syntax ... name the file .jsx or .tsx". Every content page 500'd.
 *
 *   Tina's GraphQL server only runs in dev, and this site deploys as static
 *   files to S3, so the build-time equivalent is to emit the JSON here. The
 *   authored .mdx files are untouched and remain the source of truth -- Tina
 *   collections stay on format "mdx".
 *
 * Output: projects/website-angular/content-dist/**\/*.json, each
 *   { ...frontmatter, body } -- served at /content/**. Generated, gitignored,
 *   and rebuilt by `npm start`, the e2e job and the deploy workflow.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import parseFrontmatter from '../utils/parseFrontmatter';
import imageSize from '../utils/imageSize';

const SOURCE = path.join('projects', 'website-angular', 'content');
const DEST = path.join('projects', 'website-angular', 'content-dist');
const PUBLIC = path.join('projects', 'website-angular', 'public');

/**
 * Every image a page shows, with the space it will need.
 *
 * Content images carry no dimensions, so each occupies nothing until it loads
 * and then expands. Measured on `documentation/userguide/reactome-fiviz`: 116
 * images, the document growing from 27,496px to 78,312px as they arrived, and a
 * reader who clicked a table-of-contents link left 2,793px above the section
 * they asked for -- the browser scrolled correctly and then the page grew under
 * them. Six pages carry twenty or more images and behave this way.
 *
 * These files are in this repository and change when the content does, so the
 * sizes are known here and there is no reason to make a reader's browser
 * discover them. Attached per page rather than as one manifest: a page needs
 * only its own, and a shared file would be a second request to render the
 * first paragraph.
 *
 * An image that cannot be measured is simply absent from the map, and the
 * renderer leaves it as it is.
 */
async function sizesFor(body: string): Promise<Record<string, [number, number]>> {
  const sources = new Set<string>();
  for (const [, src] of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) sources.add(src);
  for (const [, src] of body.matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) sources.add(src);

  const sizes: Record<string, [number, number]> = {};
  for (const src of sources) {
    if (!src.startsWith('/')) continue; // remote or relative; not ours to measure
    try {
      const bytes = await fs.readFile(path.join(PUBLIC, decodeURIComponent(src)));
      const size = imageSize(bytes);
      if (size) sizes[src] = [size.width, size.height];
    } catch {
      // A reference to a file that is not there. That is a content problem and
      // this is not the place to report it -- the page still renders, with the
      // broken image it already had.
    }
  }
  return sizes;
}

async function compile(from: string, to: string): Promise<{ pages: number; assets: number }> {
  let pages = 0;
  let assets = 0;
  await fs.mkdir(to, { recursive: true });

  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (entry.isDirectory()) {
      const sub = await compile(src, path.join(to, entry.name));
      pages += sub.pages;
      assets += sub.assets;
      continue;
    }

    if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      const raw = await fs.readFile(src, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const slug = entry.name.replace(/\.mdx?$/, '');
      const imageSizes = await sizesFor(body ?? '');
      await fs.writeFile(
        path.join(to, `${slug}.json`),
        JSON.stringify({
          ...frontmatter,
          body: body ?? '',
          ...(Object.keys(imageSizes).length ? { imageSizes } : {}),
        })
      );
      pages++;
    } else {
      // Images and anything else the content references, copied as-is.
      await fs.copyFile(src, path.join(to, entry.name));
      assets++;
    }
  }

  return { pages, assets };
}

async function main(): Promise<void> {
  await fs.rm(DEST, { recursive: true, force: true });
  const { pages, assets } = await compile(SOURCE, DEST);
  console.log(`compiled ${pages} content pages to JSON (+${assets} assets) -> ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
