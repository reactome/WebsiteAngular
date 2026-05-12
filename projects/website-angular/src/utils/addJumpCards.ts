// Transforms the legacy Joomla "favglyph" jump-card pattern (preserved in MDX
// exports as a placeholder link followed by a heading link to the same anchor)
// into a styled card grid, and replaces the bare "__" icon placeholder that
// appears at the start of section headings and resource list links with a
// material-symbols-rounded icon.
//
// Inputs (post-marked HTML):
//   <p><a href="#X"> __ </a></p>
//   <hN><a href="#X"> Label </a></hN>
// becomes:
//   <a class="jump-card" href="#X">
//     <span class="jump-card-icon material-symbols-rounded">ICON</span>
//     <span class="jump-card-label">Label</span>
//   </a>
// and consecutive cards are wrapped in <div class="jump-card-grid">.
//
// Inputs:
//   <a href="HREF">__Label</a>
// becomes:
//   <a href="HREF"><span class="link-icon material-symbols-rounded">ICON</span>Label</a>

const ICON_BY_ANCHOR: Record<string, string> = {
  MoreInfo: 'help',
  GetStarted: 'rocket_launch',
  API: 'code',
  Resources: 'menu_book',
};

function iconForLink(href: string, label: string): string {
  if (href.startsWith('#')) {
    const key = href.slice(1);
    if (ICON_BY_ANCHOR[key]) return ICON_BY_ANCHOR[key];
  }
  if (/^https?:/.test(href)) return 'open_in_new';
  const lower = label.toLowerCase();
  if (lower.includes('api')) return 'code';
  if (lower.includes('download')) return 'download';
  if (lower.includes('reference')) return 'library_books';
  if (lower.includes('tutorial')) return 'school';
  if (lower.includes('example')) return 'lightbulb';
  if (lower.includes('start') || lower.includes('begin')) return 'rocket_launch';
  if (lower.includes('info') || lower.includes('about')) return 'help';
  if (lower.includes('resource')) return 'menu_book';
  if (lower.includes('install')) return 'install_desktop';
  if (lower.includes('config')) return 'settings';
  return 'arrow_forward';
}

function clean(label: string): string {
  return label.replace(/^[\s_]+|[\s_]+$/g, '');
}

export default function addJumpCards(html: string): string {
  const pairRe = /<p><a href="([^"]+)">\s*(?:__\s*)?<\/a><\/p>\s*<h([1-6])><a href="\1">([^<]+)<\/a><\/h\2>/g;
  let out = html.replace(pairRe, (_m, href, _level, label) => {
    const text = clean(label);
    const icon = iconForLink(href, text);
    return `<a class="jump-card" href="${href}"><span class="jump-card-icon material-symbols-rounded">${icon}</span><span class="jump-card-label">${text}</span></a>`;
  });

  out = out.replace(
    /(?:<a class="jump-card"[^>]*>[\s\S]*?<\/a>\s*){2,}/g,
    (match) => {
      const count = (match.match(/<a class="jump-card"/g) || []).length;
      return `<div class="jump-card-grid" data-count="${count}">${match}</div>`;
    }
  );

  out = out.replace(
    /<a\s+href="([^"]+)">__\s*([^<]+)<\/a>/g,
    (_m, href, label) => {
      const text = clean(label);
      const icon = iconForLink(href, text);
      return `<a href="${href}"><span class="link-icon material-symbols-rounded">${icon}</span>${text}</a>`;
    }
  );

  return out;
}
