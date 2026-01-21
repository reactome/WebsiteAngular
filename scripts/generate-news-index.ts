import * as fs from 'fs';
import * as path from 'path';

interface NewsArticle {
  title: string;
  content: string;
  datePublished: string;
  link: string;
  author?: string;
  tags?: string[];
}

/**
 * Parse MDX/Markdown frontmatter (YAML between --- delimiters)
 */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const frontmatterStr = match[1];
  let body = match[2].trim();

  const meta: Record<string, any> = {};
  const lines = frontmatterStr.split('\n');
  let currentKey = '';
  let currentValue = '';

  lines.forEach((line) => {
    if (line.match(/^[a-z]+:/i)) {
      // New key
      if (currentKey) {
        meta[currentKey] = currentValue.trim();
      }
      const [key, ...valueParts] = line.split(':');
      currentKey = key.trim();
      currentValue = valueParts.join(':').trim().replace(/^['"]|['"]$/g, '');
    } else if (currentKey) {
      // Continuation of previous key (multiline value)
      if (currentValue) {
        currentValue += '\n' + line;
      } else {
        currentValue = line;
      }
    }
  });

  if (currentKey) {
    meta[currentKey] = currentValue.trim();
  }

  // Extract multiline body if present in frontmatter (YAML | or > syntax)
  if (meta['body']) {
    body = meta['body'];
    delete meta['body'];
  }

  return { meta, body };
}

/**
 * Load all news articles from content/news directory
 */
function loadNewsArticles(): NewsArticle[] {
  const newsDir = path.resolve(process.cwd(), 'content', 'news');

  if (!fs.existsSync(newsDir)) {
    console.warn('News directory not found:', newsDir);
    return [];
  }

  const files = fs.readdirSync(newsDir).filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));

  console.log(`Found ${files.length} news files:`, files);

  const articles = files
    .map((filename) => {
      const filePath = path.join(newsDir, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { meta, body } = parseFrontmatter(content);

      console.log(`Parsed ${filename}:`, meta);

      return {
        title: meta['title'] || filename.replace(/\.(mdx|md)$/, ''),
        content: body.slice(0, 200) + (body.length > 200 ? '...' : ''),
        datePublished: meta['date'] || new Date().toISOString(),
        link: filename.replace(/\.(mdx|md)$/, ''),
        author: meta['author'] || undefined,
        tags: typeof meta['tags'] === 'string' ? meta['tags'].split(',').map((t: string) => t.trim()) : meta['tags'],
      };
    })
    .sort(
      (a, b) =>
        new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime()
    );

  return articles;
}

/**
 * Generate a JSON file with news articles for static serving
 */
function generateNewsIndex(): void {
  const articles = loadNewsArticles();
  const outputDir = path.resolve(process.cwd(), 'content', 'news');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(articles, null, 2));

  console.log(`✅ Generated news index with ${articles.length} articles at ${outputPath}`);
}

// Run on module load
generateNewsIndex();
