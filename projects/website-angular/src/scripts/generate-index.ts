import * as fs from 'fs';
import * as path from 'path';
import { ArticleIndexItem } from '../types/article';
import parseFrontmatter from '../utils/parseFrontmatter';
import truncateHtml from '../utils/truncateHtml';

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
        title:
          frontmatter['title'] ||
          filename.replace(/\.(mdx|md)$/, ''),
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
    .sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
    );
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
function generateIndex(
  directories: string[],
  recursive: boolean = true
): void {
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
generateIndex(['projects', 'website-angular', 'content', 'content', 'reactome-research-spotlight']);
generateIndex(['projects', 'website-angular', 'content', 'documentation', 'faq'], true);