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

const SOURCE = path.join('projects', 'website-angular', 'content');
const DEST = path.join('projects', 'website-angular', 'content-dist');

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
      await fs.writeFile(
        path.join(to, `${slug}.json`),
        JSON.stringify({ ...frontmatter, body: body ?? '' })
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
