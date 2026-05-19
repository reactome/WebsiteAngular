import * as fs from 'fs';
import * as path from 'path';

// Pages that live under one of these top-level segments are MDX-backed
// content pages and *should* appear in nav-options.json. Other paths
// (e.g. /PathwayBrowser, /AnalysisService, /gsa/home) are app routes or
// external WAR endpoints and aren't this script's concern.
const CONTENT_ROOTS = ['about', 'community', 'documentation', 'tools', 'content'];

// Sections backed by a list-page route + a per-item :slug route. Their
// leaf MDX files are rendered as list items, not nav targets, so they
// should never show up in nav-options.json. Any URL nested under one of
// these prefixes (but not equal to it) is filtered out of the "missing
// from nav" report.
const LIST_SECTIONS = [
  '/about/news',
  '/content/reactome-research-spotlight',
  '/documentation/faq',
];

// Pages we deliberately keep out of the nav even though they live under a
// content root. Useful for archive/draft pages that exist on disk but
// shouldn't surface in the menu.
const NAV_OPT_OUT: Set<string> = new Set([
  // Search-results page. Reachable from the search bar; not a nav target.
  '/content/query',
]);

interface NavNode {
  label?: string;
  link?: string;
  icon?: string;
  external?: boolean;
  'dropdown-links'?: Record<string, NavNode>;
}

function findAllMdxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAllMdxFiles(full));
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function filePathToUrl(filePath: string, contentRoot: string): string {
  let rel = path.relative(contentRoot, filePath);
  rel = rel.replace(/\.(mdx|md)$/, '');
  rel = rel.replace(/(^|\/)index$/, '');
  return '/' + rel.replace(/\\/g, '/').replace(/\/$/, '');
}

function isContentUrl(url: string): boolean {
  const top = url.split('/').filter(Boolean)[0] || '';
  return CONTENT_ROOTS.includes(top);
}

function isUnderListSection(url: string): boolean {
  return LIST_SECTIONS.some(prefix => url.startsWith(prefix + '/'));
}

// Pull the static `path:` strings out of app.routes.ts. We don't need a
// real parser — the file is a flat array of route literals and the
// pattern is consistent.
function loadAngularRoutes(routesFile: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(routesFile)) return out;
  const text = fs.readFileSync(routesFile, 'utf-8');
  const re = /path:\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1];
    if (!raw || raw.includes(':') || raw.includes('*')) continue; // skip dynamic / wildcard
    out.add('/' + raw.replace(/\/$/, ''));
  }
  return out;
}

function collectNavLinks(node: Record<string, NavNode>): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(node)) {
    if (value.link && !value.external) {
      out.add(value.link.replace(/\/$/, '') || '/');
    }
    if (value['dropdown-links']) {
      for (const link of collectNavLinks(value['dropdown-links'])) {
        out.add(link);
      }
    }
  }
  return out;
}

function main(): number {
  const repoRoot = process.cwd();
  const contentRoot = path.resolve(repoRoot, 'projects', 'website-angular', 'content');
  const navOptionsPath = path.resolve(
    repoRoot, 'projects', 'website-angular', 'src', 'config', 'nav-options.json',
  );
  const routesFile = path.resolve(
    repoRoot, 'projects', 'website-angular', 'src', 'app', 'app.routes.ts',
  );

  if (!fs.existsSync(contentRoot)) {
    console.error(`Content directory not found: ${contentRoot}`);
    return 2;
  }
  if (!fs.existsSync(navOptionsPath)) {
    console.error(`nav-options.json not found: ${navOptionsPath}`);
    return 2;
  }

  const contentUrls = new Set<string>();
  for (const file of findAllMdxFiles(contentRoot)) {
    const url = filePathToUrl(file, contentRoot);
    if (NAV_OPT_OUT.has(url)) continue;
    if (isUnderListSection(url)) continue; // news/spotlight/faq leaves
    contentUrls.add(url);
  }

  const angularRoutes = loadAngularRoutes(routesFile);
  // App-routed pages (e.g. /content/toc) are valid nav targets even when
  // there's no backing MDX file. Treat them as content for diffing.
  for (const r of angularRoutes) {
    if (NAV_OPT_OUT.has(r)) continue;
    if (isContentUrl(r)) contentUrls.add(r);
  }

  const navTree = JSON.parse(fs.readFileSync(navOptionsPath, 'utf-8')) as Record<string, NavNode>;
  const navLinks = collectNavLinks(navTree);

  const missing = [...contentUrls]
    .filter(u => !navLinks.has(u))
    .sort();
  const stale = [...navLinks]
    .filter(u => isContentUrl(u) && !contentUrls.has(u))
    .sort();

  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const GREEN = '\x1b[32m';
  const RESET = '\x1b[0m';

  if (missing.length === 0 && stale.length === 0) {
    console.log(`${GREEN}nav-options.json is in sync with content/ (${contentUrls.size} pages, ${navLinks.size} nav entries).${RESET}`);
    return 0;
  }

  if (missing.length > 0) {
    console.log(`${RED}Content pages NOT in nav-options.json (${missing.length}):${RESET}`);
    for (const url of missing) console.log(`  ${url}`);
  }
  if (stale.length > 0) {
    if (missing.length > 0) console.log('');
    console.log(`${YELLOW}nav-options.json entries with no backing MDX (${stale.length}):${RESET}`);
    for (const url of stale) console.log(`  ${url}`);
  }
  console.log('');
  console.log(`Fix by editing ${path.relative(repoRoot, navOptionsPath)}, or add the URL to NAV_OPT_OUT in this script if intentional.`);
  return 1;
}

process.exit(main());
