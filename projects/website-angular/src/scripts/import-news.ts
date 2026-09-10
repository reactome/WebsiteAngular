/**
 * Import news announcements from the current site, verbatim.
 *
 * These are curated announcements: release notes, publications, contributor
 * credits. The words matter exactly as written -- a paraphrase is a different
 * announcement, and "close enough" is not a thing here. So this converts the
 * markup and never the prose, and then checks its own work: the plain text of
 * what it wrote has to equal the plain text of the source, word for word, or it
 * refuses to write the file.
 *
 *   npx tsx projects/website-angular/src/scripts/import-news.ts --missing
 *   npx tsx projects/website-angular/src/scripts/import-news.ts 295-v97-released
 *
 * --missing compares the current site's listing against content/about/news and
 * imports whatever is not here yet. Existing files are never overwritten unless
 * --force is given: they may have been edited by hand since.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SOURCE = 'https://reactome.org';
const NEWS_DIR = path.join(process.cwd(), 'projects/website-angular/content/about/news');
const IMAGE_DIR = path.join(process.cwd(), 'projects/website-angular/public/images');

// ---- fetching -------------------------------------------------------------

async function page(url: string) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return await response.text();
}

/** Every news slug the current site lists, newest first. */
async function publishedSlugs() {
  const html = await page(`${SOURCE}/about/news`);
  const slugs: string[] = [];
  for (const [, slug] of html.matchAll(/href="\/about\/news\/([^"#?]+)"/g)) {
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

// ---- markup, not prose ----------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  deg: '°',
  times: '×',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  kappa: 'κ',
};

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Cloudflare hides addresses behind a hex blob and rewrites them in the
 * browser. Left alone it scrapes as the literal string "[email protected]",
 * which is how an earlier import ended up with "Follow us on [email protected]
 * get frequent updates" -- a sentence nobody wrote.
 */
function decodeCloudflareEmail(hex: string) {
  const key = parseInt(hex.slice(0, 2), 16);
  let email = '';
  for (let at = 2; at < hex.length; at += 2) {
    email += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16) ^ key);
  }
  return email;
}

/**
 * Cloudflare's other form: an ordinary-looking link whose fragment is the
 * encoded address, wrapping whatever the page had there before -- on some pages
 * that is a Joomla cloak, so this runs first and takes the nesting with it.
 */
function resolveCloudflareLinks(html: string) {
  return html.replace(
    /<a[^>]*href="[^"]*\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"[^>]*>[\s\S]*?<\/a>/gi,
    (_match, hex: string) => {
      const email = decodeCloudflareEmail(hex);
      return `<a href="mailto:${email}">${email}</a>`;
    }
  );
}

/**
 * Joomla hides addresses too, differently: a span saying "This email address is
 * being protected from spambots" plus a script that rebuilds the real address
 * from entity-encoded fragments. Left alone the page reads as the warning
 * sentence rather than the address, and the sentence is not what anyone wrote.
 *
 * Resolved before anything else looks at the body, so the conversion and the
 * check that follows it are comparing the same thing.
 */
function resolveJoomlaCloak(html: string) {
  return html.replace(
    /<span id="cloak([0-9a-f]+)">[\s\S]*?<\/span>\s*<script[^>]*>([\s\S]*?)<\/script>/gi,
    (_match, id: string, script: string) => {
      const gather = (variable: string) => {
        const parts: string[] = [];
        // Up to the closing quote of the last fragment, not to the first
        // semicolon: the fragments are entity-encoded ('h&#101;lp'), so a
        // semicolon appears inside the value and stopping there read one letter
        // of the address and dropped the rest.
        const assignment = new RegExp(`${variable}${id}\\s*=\\s*([\\s\\S]*?'\\s*;)`, 'g');
        for (let found = assignment.exec(script); found; found = assignment.exec(script)) {
          for (const [, quoted] of found[1].matchAll(/'([^']*)'/g)) parts.push(quoted);
        }
        return decodeEntities(parts.join(''));
      };
      const shown = gather('addy_text');
      const address = gather('addy') || shown;
      return shown ? `<a href="mailto:${address}">${shown}</a>` : '';
    }
  );
}

/** Site-relative for our own links, untouched for everyone else's. */
function localise(url: string) {
  const ours = url.match(/^https?:\/\/(?:www\.)?reactome\.org(\/.*)?$/i);
  if (ours) return ours[1] || '/';
  return url;
}

/** The text of one element, with its own markup removed. */
function plain(html: string) {
  return decodeEntities(
    html
      // A script's own source is not prose; the markdown side drops these too.
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(
        /<a[^>]*class="__cf_email__"[^>]*data-cfemail="([0-9a-f]+)"[^>]*>.*?<\/a>/gis,
        (_m, hex) => decodeCloudflareEmail(hex)
      )
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ');
}

/**
 * The article body as markdown.
 *
 * Block elements become paragraphs, anchors and images keep their targets in the
 * angle-bracket form the existing files use, and every character of text is
 * passed through as it was found.
 *
 * Targets are held as placeholders until the end. Written straight out, a target
 * like `</images/thing.png>` is indistinguishable from a closing tag, and the
 * step that strips the remaining markup ate every link on the page.
 */
const OPEN = '\u0001';
const CLOSE = '\u0002';

function toMarkdown(body: string) {
  let html = body
    // Announcements carry no scripts or styles worth keeping.
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<a[^>]*class="__cf_email__"[^>]*data-cfemail="([0-9a-f]+)"[^>]*>.*?<\/a>/gis,
      (_m, hex) => decodeCloudflareEmail(hex)
    )
    // Images before anchors: an image inside a link keeps both.
    .replace(/<img[^>]*>/gi, (tag) => {
      const src = /src="([^"]+)"/i.exec(tag)?.[1] ?? '';
      const alt = /alt="([^"]*)"/i.exec(tag)?.[1] ?? '';
      return src ? `\n\n![${decodeEntities(alt)}](${OPEN}${localise(src)}${CLOSE})\n\n` : '';
    })
    .replace(
      /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, text: string) => {
        const inside = plain(text);
        const label = inside.trim();
        // Whitespace inside the anchor moves outside it. One announcement links
        // "BlueSky@reactome.org " with the space inside the tag, and trimming the
        // label without putting it back joined the link to the next word.
        const lead = /^\s/.test(inside) ? ' ' : '';
        const trail = /\s$/.test(inside) ? ' ' : '';
        return label
          ? `${lead}[${label}](${OPEN}${localise(decodeEntities(href))}${CLOSE})${trail}`
          : inside;
      }
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');

  html = decodeEntities(html);

  // Paragraphs, each with its internal whitespace collapsed. The source is
  // indented HTML, so its newlines and tabs are markup rather than content.
  return html
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .split(OPEN)
    .join('<')
    .split(CLOSE)
    .join('>');
}

// ---- one announcement -----------------------------------------------------

function articleBody(html: string) {
  // The body is marked up for search engines, which is a more stable hook than
  // any of the theme's class names.
  const start = html.search(/itemprop="articleBody"/i);
  if (start < 0) throw new Error('no articleBody on the page');
  const open = html.indexOf('>', start) + 1;

  // Walk to the matching close of that div rather than to the first one.
  let depth = 1;
  let at = open;
  const tag = /<(\/?)div\b/gi;
  tag.lastIndex = open;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      at = match.index;
      break;
    }
  }
  return html.slice(open, at);
}

function title(html: string) {
  const heading = /<h[12][^>]*>\s*([^<]{3,120}?)\s*<\/h[12]>/i.exec(html);
  if (heading) return decodeEntities(heading[1]).replace(/\s+/g, ' ').trim();
  const tag = /<title>([^<]+)<\/title>/i.exec(html);
  return tag ? decodeEntities(tag[1]).split('|')[0].trim() : '';
}

function published(html: string) {
  return /datetime="([^"]+)"/i.exec(html)?.[1] ?? '';
}

/** Bring an image the announcement points at into the site's own assets. */
async function fetchImage(url: string) {
  const name = path.basename(url.split('?')[0]);
  const destination = path.join(IMAGE_DIR, name);
  if (existsSync(destination)) return { name, fetched: false };

  const response = await fetch(`${SOURCE}${url}`);
  if (!response.ok) throw new Error(`${response.status} for image ${url}`);
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return { name, fetched: true };
}

/**
 * The proof that nothing was reworded: strip the markdown back to text and
 * compare it with the source's text. Link labels survive both ways, so what is
 * left on each side is exactly the prose.
 */
function sameWords(markdown: string, sourceHtml: string) {
  const fromMarkdown = markdown
    .replace(/!\[[^\]]*\]\(<[^>]*>\)/g, ' ')
    .replace(/\[([^\]]*)\]\(<[^>]*>\)/g, '$1')
    .replace(/^-\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fromSource = plain(sourceHtml).trim();
  return { equal: fromMarkdown === fromSource, fromMarkdown, fromSource };
}

async function importOne(slug: string, force: boolean) {
  const file = path.join(NEWS_DIR, `${slug}.mdx`);
  if (existsSync(file) && !force) {
    console.log(`  ${slug}: already here, left alone`);
    return false;
  }

  const html = await page(`${SOURCE}/about/news/${slug}`);
  const raw = articleBody(html);
  const body = resolveJoomlaCloak(resolveCloudflareLinks(raw));

  // An address that fails to decode disappears silently: the comparison below
  // reads the same resolved body, so both sides lose it together and agree. So
  // count them instead -- every hidden address has to come out the other side.
  const hidden = (raw.match(/id="cloak|email-protection#|__cf_email__/g) ?? []).length;
  const found = (body.match(/mailto:/g) ?? []).length;
  if (found < 1 && hidden > 0) {
    console.error(`  ${slug}: REFUSED -- ${hidden} hidden address(es) and none decoded`);
    return false;
  }
  if (body.includes('protected from spambots')) {
    console.error(`  ${slug}: REFUSED -- an address is still hidden behind its warning text`);
    return false;
  }
  const name = title(html);
  const date = published(html);
  if (!name) throw new Error(`no title found for ${slug}`);

  let markdown = toMarkdown(body);

  // The announcement's own images, brought local so the page does not depend on
  // the other site staying up.
  for (const [, url] of markdown.matchAll(/!\[[^\]]*\]\(<(\/images\/[^>]+)>\)/g)) {
    const image = await fetchImage(url);
    console.log(`    image ${image.name}${image.fetched ? ' (downloaded)' : ' (already here)'}`);
  }

  const check = sameWords(markdown, body);
  if (!check.equal) {
    const at = [...check.fromSource].findIndex((char, index) => check.fromMarkdown[index] !== char);
    console.error(`  ${slug}: REFUSED -- the text does not match the source at character ${at}`);
    console.error(`    source:   ...${check.fromSource.slice(Math.max(0, at - 60), at + 60)}...`);
    console.error(`    imported: ...${check.fromMarkdown.slice(Math.max(0, at - 60), at + 60)}...`);
    return false;
  }

  // The heading is part of the body in these files, and the existing ones open
  // with it.
  if (!markdown.startsWith(`## ${name}`)) markdown = `## ${name}\n\n${markdown}`;

  const frontmatter = [
    '---',
    `title: "${name.replace(/"/g, '\\"')}"`,
    'category: "about"',
    `date: "${date}"`,
    `tags: ["about", "news", "${slug}"]`,
    '---',
    '',
    '',
  ].join('\n');

  await writeFile(file, frontmatter + markdown + '\n', 'utf8');
  console.log(
    `  ${slug}: written, ${markdown.length} characters, text verified against the source`
  );
  return true;
}

// ---- entry point ----------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const wanted = args.filter((arg) => !arg.startsWith('--'));

  let slugs = wanted;
  if (args.includes('--missing')) {
    const here = new Set(
      (await readdir(NEWS_DIR))
        .filter((f) => f.endsWith('.mdx'))
        .map((f) => f.replace(/\.mdx$/, ''))
    );
    const published = await publishedSlugs();
    slugs = published.filter((slug) => !here.has(slug));
    console.log(`  ${published.length} announcements published, ${slugs.length} not here yet`);
  }

  if (!slugs.length) {
    console.log('  nothing to import');
    return;
  }

  let written = 0;
  for (const slug of slugs) {
    try {
      if (await importOne(slug, force)) written++;
    } catch (failure) {
      console.error(`  ${slug}: ${(failure as Error).message}`);
    }
  }
  console.log(`  ${written} imported`);
  if (written) console.log('  run `npm run generate:indices` to put them in the listing');
}

// Awaited at the top level would be cleaner, but tsx compiles this to CommonJS
// and rejects it.
void main();

/** Exported for the unit test, which checks the conversion rather than the web. */
export const forTests = {
  toMarkdown,
  sameWords,
  decodeCloudflareEmail,
  resolveJoomlaCloak,
  resolveCloudflareLinks,
  localise,
  plain,
};
