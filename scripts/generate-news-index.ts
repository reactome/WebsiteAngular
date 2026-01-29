import * as fs from 'fs';
import * as path from 'path';

export interface NewsIndexItem {
   title: string;
  author?: string;
  date: Date;

  image?: string;
  tags?: string[];

  excerpt?: string;

  slug: string;
}

/**
 * Parse frontmatter from MDX content
 */
export default function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = match[1];
  const body = match[2];

  // Simple YAML parsing for frontmatter
  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterStr.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value: string | string[] = line.substring(colonIndex + 1).trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Handle arrays (tags, etc.)
      if (key === 'tags' || line.trim() === `${key}:`) {
        // Check for array items in following lines
        continue;
      }

      frontmatter[key] = value;
    } else if (line.trim().startsWith('- ')) {
      // Handle array item
      const lastKey = Object.keys(frontmatter).pop();
      if (lastKey) {
        if (!Array.isArray(frontmatter[lastKey])) {
          frontmatter[lastKey] = [];
        }
        (frontmatter[lastKey] as string[]).push(line.trim().substring(2));
      }
    }
  }

  return { frontmatter, body };
}


/**
 * Load all news articles from content/news directory
 */
function loadNewsArticles(): NewsIndexItem[] {
  const newsDir = path.resolve(process.cwd(), 'content', 'about', 'news');

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
        excerpt: body.slice(0, 200) + (body.length > 200 ? '...' : ''),
        date: frontmatter['date'] || new Date().toISOString(),
        slug: filename.replace(/\.(mdx|md)$/, ''), //TODO: This might be wrong lol
        tags: typeof frontmatter['tags'] === 'string' ? frontmatter['tags'].split(',').map((t: string) => t.trim()) : frontmatter['tags'],
      } as NewsIndexItem;
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
function generateNewsIndex(): void {
  const articles = loadNewsArticles();
  const outputDir = path.resolve(process.cwd(), 'content', 'about', 'news');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(articles, null, 2));

}

// Run on module load
generateNewsIndex();
