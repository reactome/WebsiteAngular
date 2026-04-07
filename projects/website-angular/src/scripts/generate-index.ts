import * as fs from 'fs';
import * as path from 'path';
import { ArticleIndexItem } from '../types/article';
import { SiteSearchIndexItem } from '../types/site-search';
import parseFrontmatter from '../utils/parseFrontmatter';
import truncateHtml from '../utils/truncateHtml';

/**
 * Strip markdown/MDX syntax to produce plain text for search indexing
 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n?/, '') // frontmatter
    .replace(/import\s+.*?from\s+['"].*?['"]\s*;?\n?/g, '') // ESM imports
    .replace(/<[^>]+>/g, '') // HTML/JSX tags
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/#{1,6}\s+/g, '') // headings
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2') // bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline/block code
    .replace(/>\s?/gm, '') // blockquotes
    .replace(/[-*+]\s+/gm, '') // list markers
    .replace(/\d+\.\s+/gm, '') // ordered list markers
    .replace(/\n{2,}/g, '\n') // collapse blank lines
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

/**
 * Recursively find all .mdx/.md files in a directory
 */
function findAllMdxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAllMdxFiles(fullPath));
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      // Skip index.json artifacts
      if (entry.name !== 'index.json') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Map a file path to its site URL
 * e.g. content/about/what-is-reactome.mdx → /about/what-is-reactome
 *      content/about/news/article-1.mdx   → /about/news/article-1
 *      content/documentation/dev/index.mdx → /documentation/dev
 */
function filePathToUrl(filePath: string, contentRoot: string): string {
  let relative = path.relative(contentRoot, filePath);
  // Remove extension
  relative = relative.replace(/\.(mdx|md)$/, '');
  // Remove trailing /index
  relative = relative.replace(/\/index$/, '');
  // Convert to URL
  return '/' + relative.replace(/\\/g, '/');
}

/**
 * Infer a human-readable category from the top-level directory
 */
function inferCategory(url: string): string {
  const categoryMap: Record<string, string> = {
    about: 'About',
    content: 'Content',
    documentation: 'Documentation',
    community: 'Community',
    tools: 'Tools',
  };
  const topDir = url.split('/')[1] || '';
  // Special sub-categories
  if (url.startsWith('/about/news/')) return 'News';
  if (url.startsWith('/content/reactome-research-spotlight/'))
    return 'Research Spotlight';
  return categoryMap[topDir] || 'Other';
}

/**
 * Generate a consolidated site search index covering all content
 */
function generateSiteSearchIndex(): void {
  const contentRoot = path.resolve(
    process.cwd(),
    'projects',
    'website-angular',
    'content'
  );

  if (!fs.existsSync(contentRoot)) {
    console.warn('Content directory not found:', contentRoot);
    return;
  }

  const allFiles = findAllMdxFiles(contentRoot);
  const items: SiteSearchIndexItem[] = [];
  const seenUrls = new Set<string>();
  let nextId = 1;

  for (const filePath of allFiles) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    const url = filePathToUrl(filePath, contentRoot);

    // Skip duplicates (e.g. collaboration.mdx and collaboration/index.mdx)
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title =
      (frontmatter['title'] as string) ||
      path
        .basename(filePath)
        .replace(/\.(mdx|md)$/, '')
        .replace(/-/g, ' ');
    const category = (frontmatter['category'] as string)
      ? inferCategory(url)
      : inferCategory(url);
    const plainBody = stripMarkdown(body);
    const excerpt =
      plainBody.slice(0, 200) + (plainBody.length > 200 ? '...' : '');

    items.push({
      id: nextId++,
      title,
      category,
      url,
      body: plainBody,
      excerpt,
      date: (frontmatter['date'] as string) || undefined,
    });
  }

  // Write to public assets so it can be fetched at runtime
  const outputDir = path.resolve(
    process.cwd(),
    'projects',
    'website-angular',
    'public'
  );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'site-search-index.json');
  fs.writeFileSync(outputPath, JSON.stringify(items));
  console.log(
    `Site search index generated: ${items.length} entries → ${outputPath}`
  ); //This chaned to test autofix
}

function loadNewsArticlesFromDir(dir: string): ArticleIndexItem[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));

  return files
    .map((filename) => {
      const filePath = path.join(dir, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      return {
        title: frontmatter['title'] || filename.replace(/\.(mdx|md)$/, ''),
        author: frontmatter['author'] || undefined,
        excerpt: truncateHtml(body || '', 50),
        date: frontmatter['date'] || new Date().toISOString(),
        slug: filename.replace(/\.(mdx|md)$/, ''),
        tags:
          typeof frontmatter['tags'] === 'string'
            ? frontmatter['tags']
                .split(',')
                .map((t: string) =>
                  t.trim().replace(/^[\[\["']+|[\]'"]+$/g, '')
                )
            : frontmatter['tags'],
      } as ArticleIndexItem;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function buildRecursiveIndex(dir: string): any {
  const result: Record<string, any> = {};

  // Root-level articles
  const rootArticles = loadNewsArticlesFromDir(dir);
  if (rootArticles.length > 0) {
    result['articles'] = rootArticles;
  }

  // Subdirectories
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subdirPath = path.join(dir, entry.name);
      const subIndex = buildRecursiveIndex(subdirPath);

      // Only include if it has content
      if (Object.keys(subIndex).length > 0) {
        result[entry.name] = subIndex;
      }
    }
  }

  return result;
}

/**
 * Generate a JSON file with optional recursive indexing
 */
function generateIndex(directories: string[], recursive: boolean = true): void {
  const outputDir = path.resolve(process.cwd(), ...directories);

  if (!fs.existsSync(outputDir)) {
    console.warn('Directory not found:', outputDir);
    return;
  }

  const index = recursive
    ? buildRecursiveIndex(outputDir)
    : { articles: loadNewsArticlesFromDir(outputDir) };

  const outputPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));
}

// Run on module load
generateIndex(['projects', 'website-angular', 'content', 'about', 'news']);
generateIndex([
  'projects',
  'website-angular',
  'content',
  'content',
  'reactome-research-spotlight',
]);
generateIndex(
  ['projects', 'website-angular', 'content', 'documentation', 'faq'],
  true
);
generateSiteSearchIndex();
