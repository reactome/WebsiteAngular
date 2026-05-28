// Adds id="X" attributes to headings so same-page #fragment links jump
// to them. Handles two patterns the Joomla -> MDX export left behind:
//
//   1. Headings whose first child is an anchor link to "#X" (the
//      pattern used by pages that explicitly link each heading to
//      itself, like the jump-card pages). When the same href appears
//      in multiple headings (e.g. an H2 jump card at the top plus the
//      matching H3 section below it), only the LAST occurrence gets
//      the id so clicks land on the section, not the jump card.
//
//   2. Plain `<hN>Section Text</hN>` headings whose slugified text
//      matches a same-page #fragment used elsewhere on the page
//      (typically a TOC list at the top). The fragment format follows
//      the legacy Joomla convention: spaces -> underscores, with
//      heading text used verbatim.
export default function addAnchorIds(html: string): string {
  // Pass 1: existing behaviour -- headings whose first child is the anchor.
  const re = /<(h[1-6])>\s*(<a\s[^>]*href="#([^"]+)"[^>]*>)/g;
  const matches: { index: number; length: number; tag: string; href: string; full: string }[] = [];
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    matches.push({ index: m.index, length: m[0].length, tag: m[1], href: m[3], full: m[0] });
  }
  const lastByHref = new Map<string, number>();
  matches.forEach((m, i) => lastByHref.set(m.href, i));
  let out = '';
  let cursor = 0;
  matches.forEach((m, i) => {
    out += html.slice(cursor, m.index);
    if (lastByHref.get(m.href) === i) {
      out += `<${m.tag} id="${m.href}">` + m.full.slice(m.tag.length + 2);
    } else {
      out += m.full;
    }
    cursor = m.index + m.length;
  });
  out += html.slice(cursor);

  // Pass 2: plain headings (no inner anchor) whose slugified text
  // matches a #fragment referenced anywhere on the page.
  const fragments = new Set<string>();
  for (const m of out.matchAll(/href="#([^"]+)"/g)) fragments.add(m[1]);
  if (fragments.size === 0) return out;

  out = out.replace(
    /<(h[1-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/g,
    (full, tag, attrs, inner) => {
      // Skip headings that already have an id (pass 1 added one).
      if (attrs && /\bid=/.test(attrs)) return full;
      // Skip headings whose content is itself a link (pass 1 would have
      // handled them if the link target matched).
      // Use the heading's plain text to compute the slug.
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (!text) return full;
      const slug = text.replace(/\s+/g, '_');
      if (!fragments.has(slug)) return full;
      return `<${tag}${attrs || ''} id="${slug}">${inner}</${tag}>`;
    },
  );
  return out;
}
