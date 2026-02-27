import * as fs from 'fs';
import * as path from 'path';
import { ArticleIndexItem } from '../types/article';
import parseFrontmatter from '../utils/parseFrontmatter';
import truncateHtml from '../utils/truncateHtml';

function loadNewsArticles(...directories: string[]): ArticleIndexItem[] {
  const newsDir = path.resolve(process.cwd(), ...directories);

  if (!fs.existsSync(newsDir)) {
    console.warn('News directory not found:', newsDir);
    return [];
  }

  const files = fs.readdirSync(newsDir).filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));
  const articles = files
    .map((filename) => {
      const filePath = path.join(newsDir, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      return {
        title: frontmatter['title'] || filename.replace(/\.(mdx|md)$/, ''),
        author: frontmatter['author'] || undefined,
        excerpt: truncateHtml(body || '', 50),
        date: frontmatter['date'] || new Date().toISOString(),
        slug: filename.replace(/\.(mdx|md)$/, ''),
        tags: typeof frontmatter['tags'] === 'string' ? frontmatter['tags'].split(',').map((t: string) => t.trim().replace(/^[\[\["']+|[\]'"]+$/g, '')) : frontmatter['tags'],
      } as ArticleIndexItem;
    })
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  return articles;
}

/**
 * Generate a JSON file with news articles for static serving
 */
function generateIndex(...directories: string[]): void {
  const articles = loadNewsArticles(...directories);
  const outputDir = path.resolve(process.cwd(), ...directories);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(articles, null, 2));

}

// Run on module load
generateIndex('projects', 'website-angular', 'content', 'about', 'news');
generateIndex('projects', 'website-angular', 'content', 'content', 'reactome-research-spotlight')
generateIndex('projects', 'website-angular', 'content', 'documentation', 'faq');