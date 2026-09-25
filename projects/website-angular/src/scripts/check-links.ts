import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';
import addAnchorIds from '../utils/addAnchorIds';
import parseFrontmatter from '../utils/parseFrontmatter';
import { STILL_ON_PRODUCTION } from '../utils/rewriteContentUrls';

/**
 * Every internal link in the site's content, navigation and templates has to
 * lead somewhere that exists.
 *
 * Links are resolved against what the site is made of -- content files, router
 * paths, static files -- and never by fetching them. This site answers 200 for
 * a page that does not exist (the not-found page is rendered by the app), so a
 * fetch calls every broken link healthy. That is how 73 of them accumulated.
 *
 * Links are read from the HTML that marked makes of each file -- what the site
 * renders -- not from the raw text, so every markdown spelling counts: a regex
 * over the text missed `<https://…>` autolinks, and four of them were broken.
 * A fragment on a content page must name an id that page renders.
 *
 * Not checked, and not claimed: links built from bound values in templates,
 * fragments on pages other than content pages, and external sites.
 *
 *     npm run check:links
 */

const ROOT = path.resolve(__dirname, '../../../..');
const SITE = path.join(ROOT, 'projects/website-angular');
const CONTENT = path.join(SITE, 'content');

/**
 * Served beside the site rather than by its router: the pathway browser, the
 * backend services the site proxies, and the chatbot. A link under one of these
 * is not checked further.
 */
const SERVED_ELSEWHERE = [
  '/PathwayBrowser/',
  '/ContentService/',
  '/AnalysisService/',
  '/RenderService/',
  '/GSAServer/',
  '/chat',
];

/** Routes whose `:slug` is a content file. */
const CONTENT_COLLECTIONS = ['/about/news/', '/content/reactome-research-spotlight/'];

/**
 * Links that are known to be broken and are waiting on something named here.
 * Keep each with its reason; an entry with no reason is a broken link hidden.
 */
const GSA_DECISION = 'the old ReactomeGSA entry point; where it should lead is being decided';
const TRAINING_UPLOAD =
  'training material too large for the repository; to be published to the download bucket';
export const KNOWN_BROKEN: Record<string, string> = {
  '/gsa': GSA_DECISION,
  '/docs/training/Reactome_Website.pdf': TRAINING_UPLOAD,
  '/docs/training/Pathways_&_Networks_Overview.pdf': TRAINING_UPLOAD,
  '/docs/training/ReactomeFIVizapp.pdf': TRAINING_UPLOAD,
  '/docs/training/ReactomeFIVizapp_Lab_Questions.pdf': TRAINING_UPLOAD,
  '/docs/training/ReactomeFIVizapp_Lab_Answers.pdf': TRAINING_UPLOAD,
};

export interface Link {
  file: string;
  line: number;
  url: string;
}

function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full, keep);
    return keep(entry.name) ? [full] : [];
  });
}

/** The content page URLs, exactly as `generate-index.ts` maps files to URLs. */
export function contentUrls(contentRoot = CONTENT): Set<string> {
  return new Set(
    walk(contentRoot, (name) => /\.mdx?$/.test(name)).map((file) => {
      const rel = path
        .relative(contentRoot, file)
        .replace(/\.(mdx|md)$/, '')
        .replace(/(^|\/)index$/, '');
      return '/' + rel.replace(/\\/g, '/').replace(/\/$/, '');
    })
  );
}

/** Router paths from app.routes.ts, as patterns: `:param` matches one segment. */
export function routePatterns(routesFile = path.join(SITE, 'src/app/app.routes.ts')): RegExp[] {
  const source = fs.readFileSync(routesFile, 'utf8');
  return [...source.matchAll(/path:\s*'([^']*)'/g)]
    .map((m) => m[1])
    .filter((p) => p !== '**')
    .map((p) => {
      const pattern = p
        .split('/')
        .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
      return new RegExp(`^/${pattern}$`);
    });
}

/** Files the site serves as they are: public/ at the root, and the two assets folders. */
function staticFileExists(urlPath: string): boolean {
  const candidates = [
    path.join(SITE, 'public', urlPath),
    ...(urlPath.startsWith('/assets/')
      ? [path.join(SITE, 'src', urlPath), path.join(ROOT, 'projects/pathway-browser/src', urlPath)]
      : []),
  ];
  return candidates.some((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

/**
 * The site path a link leads to, or null when it is not internal.
 *
 * Mirrors the page component: a reactome.org URL is rewritten to this site's
 * own path, and a path without a leading slash resolves from the root, because
 * the base href is `/`.
 */
export function internalPath(url: string): string | null {
  let target = url.trim();
  if (!target || target.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(target)) {
    return null;
  }
  const reactome = target.match(/^https?:\/\/(?:www\.)?reactome\.org(\/.*)?$/i);
  // Left on production by the renderer, so not this site's to resolve.
  if (reactome && STILL_ON_PRODUCTION.some((p) => p.test((reactome[1] ?? '').replace(/^\//, '')))) {
    return null;
  }
  if (reactome) target = reactome[1] || '/';
  else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  target = target.split('#')[0].split('?')[0];
  if (!target) return null;
  if (!target.startsWith('/')) target = '/' + target;
  try {
    target = decodeURI(target);
  } catch {
    // A malformed escape is still a path; check it as written.
  }
  return target.length > 1 ? target.replace(/\/+$/, '') : target;
}

export function resolves(
  urlPath: string,
  pages: Set<string>,
  routes: RegExp[],
  fileExists: (p: string) => boolean = staticFileExists
): boolean {
  if (urlPath === '/') return true;
  if (
    SERVED_ELSEWHERE.some(
      (prefix) => urlPath === prefix.replace(/\/$/, '') || urlPath.startsWith(prefix)
    )
  ) {
    return true;
  }
  if (pages.has(urlPath)) return true;
  // These routes take any slug, but each article is a file: a mistyped slug
  // matches the route and shows the not-found page.
  if (CONTENT_COLLECTIONS.some((prefix) => urlPath.startsWith(prefix))) return false;
  if (routes.some((route) => route.test(urlPath))) return true;
  return fileExists(urlPath);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** HTML-attribute entities marked writes into URLs. */
function unescapeAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** The HTML the site renders for a content file's body. */
export function renderedHtml(text: string): string {
  return marked.parse(parseFrontmatter(text).body, { async: false }) as string;
}

/**
 * Links in a content file, read from its rendered HTML.
 *
 * The line is where the URL first appears in the file, for the report; a URL
 * marked had to encode may not be found as written, and reports line 0.
 */
export function linksInContent(file: string, text: string): Link[] {
  const found: Link[] = [];
  for (const m of renderedHtml(text).matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)) {
    const url = unescapeAttr(m[1]);
    let at = text.indexOf(url);
    if (at < 0) {
      try {
        at = text.indexOf(decodeURI(url));
      } catch {
        // A malformed escape: report the link without a line.
      }
    }
    found.push({ file, line: at < 0 ? 0 : lineOf(text, at), url });
  }
  return found;
}

const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|avif|ico)$/i;

/**
 * Image sources in a content file that do not name an image.
 *
 * The importer turned some linked images into an image of the *link*:
 * `![](https://www.biorxiv.org/content/…)` beside the real picture, which a
 * browser draws as a broken image. A source has to name an image file.
 */
export function nonImages(file: string, text: string): Link[] {
  const found: Link[] = [];
  const sources = [
    ...text.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))/g),
    ...text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g),
  ];
  for (const m of sources) {
    const url = m[1] ?? m[2];
    if (url.startsWith('data:')) continue;
    const local = internalPath(url);
    const onDisk = local === null ? null : localFile(local);
    // A local file is judged by its bytes: fifty user-guide images are PNGs
    // saved without an extension. One that is missing is the link check's to
    // report, not this one's.
    const ok =
      local !== null
        ? !onDisk || looksLikeImage(onDisk)
        : IMAGE_FILE.test(url.split('#')[0].split('?')[0]);
    if (!ok) found.push({ file, line: lineOf(text, m.index ?? 0), url });
  }
  return found;
}

function localFile(urlPath: string): string | null {
  const file = path.join(SITE, 'public', urlPath);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

/** PNG, JPEG, GIF, WebP or SVG, by the first bytes of the file. */
function looksLikeImage(file: string): boolean {
  const head = Buffer.alloc(256);
  const fd = fs.openSync(file, 'r');
  const n = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const bytes = head.subarray(0, n);
  const text = bytes.toString('utf8');
  return (
    bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    text.startsWith('GIF8') ||
    (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') ||
    /<svg[\s>]/.test(text) ||
    (text.trimStart().startsWith('<?xml') && text.includes('<svg'))
  );
}

/** Literal links in a template; bound values (`[href]`, interpolation) cannot be checked statically. */
export function linksInTemplate(file: string, text: string): Link[] {
  const found: Link[] = [];
  for (const m of text.matchAll(/(?<![[\w-])(?:href|routerLink)\s*=\s*"([^"{}]+)"/g)) {
    found.push({ file, line: lineOf(text, m.index ?? 0), url: m[1] });
  }
  // A bound routerLink that is only a literal: [routerLink]="['/content/query']".
  for (const m of text.matchAll(/\[routerLink\]\s*=\s*"\[\s*'(\/[^']*)'\s*\]"/g)) {
    found.push({ file, line: lineOf(text, m.index ?? 0), url: m[1] });
  }
  return found;
}

function linksInNav(file: string, text: string): Link[] {
  const found: Link[] = [];
  for (const m of text.matchAll(/"link"\s*:\s*"([^"]+)"/g)) {
    found.push({ file, line: lineOf(text, m.index ?? 0), url: m[1] });
  }
  return found;
}

export function allLinks(): Link[] {
  const rel = (file: string) => path.relative(ROOT, file);
  return [
    ...walk(CONTENT, (n) => /\.mdx?$/.test(n)).flatMap((f) =>
      linksInContent(rel(f), fs.readFileSync(f, 'utf8'))
    ),
    ...walk(path.join(SITE, 'src/app'), (n) => n.endsWith('.html')).flatMap((f) =>
      linksInTemplate(rel(f), fs.readFileSync(f, 'utf8'))
    ),
    ...[path.join(SITE, 'src/config/nav-options.json')].flatMap((f) =>
      linksInNav(rel(f), fs.readFileSync(f, 'utf8'))
    ),
  ];
}

/** Ids a content page renders, including the ones addAnchorIds gives headings. */
const idsByPage = new Map<string, Set<string>>();
function idsOn(urlPath: string): Set<string> | null {
  const rel = urlPath.replace(/^\//, '');
  const file = [`${rel}.mdx`, `${rel}.md`, `${rel}/index.mdx`, `${rel}/index.md`]
    .map((f) => path.join(CONTENT, f))
    .find((f) => fs.existsSync(f));
  if (!file) return null;
  if (!idsByPage.has(file)) {
    const html = addAnchorIds(renderedHtml(fs.readFileSync(file, 'utf8')));
    idsByPage.set(file, new Set([...html.matchAll(/\b(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsByPage.get(file) ?? null;
}

export function brokenLinks(links = allLinks()): (Link & { path: string })[] {
  const pages = contentUrls();
  const routes = routePatterns();
  return links.flatMap((link) => {
    const target = internalPath(link.url);
    if (target === null) return [];
    if (!resolves(target, pages, routes)) return [{ ...link, path: target }];
    // A fragment is the point of a link like /documentation#training: on a
    // content page it has to name something the page renders, or the reader
    // lands at the top of a long page.
    const fragment = link.url.split('#')[1];
    // Only where the content file is what renders: a routed component (the
    // logo page) owns its own ids.
    const rendersContent = pages.has(target) && !routes.some((route) => route.test(target));
    const ids = fragment && rendersContent ? idsOn(target) : null;
    if (ids && !ids.has(decodeURIComponent(fragment))) {
      return [{ ...link, path: `${target}#${fragment}` }];
    }
    return [];
  });
}

export function allNonImages(): Link[] {
  return walk(CONTENT, (n) => /\.mdx?$/.test(n)).flatMap((f) =>
    nonImages(path.relative(ROOT, f), fs.readFileSync(f, 'utf8'))
  );
}

function main() {
  const links = allLinks();
  const broken = brokenLinks(links);
  const images = allNonImages();
  for (const i of images) console.log(`${i.file}:${i.line}  not an image: ${i.url}`);
  const unexplained = broken.filter((b) => !(b.path in KNOWN_BROKEN));
  const known = broken.length - unexplained.length;
  for (const b of unexplained) console.log(`${b.file}:${b.line}  ${b.url}`);
  console.log(
    `\n${links.length} links checked; ${unexplained.length} broken` +
      (known ? `, ${known} known and waiting (see KNOWN_BROKEN)` : '') +
      '.'
  );
  if (images.length) console.log(`${images.length} image sources that are not images.`);
  if (unexplained.length || images.length) process.exit(1);
}

if (require.main === module) main();
