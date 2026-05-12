// Adds id="X" to headings whose first child is an anchor link to "#X".
// The Joomla->MDX export stripped explicit id="X" attributes from section
// headings, leaving same-page jump links with no target. When the same href
// appears in multiple headings (e.g. an H2 jump card at the top of the page
// plus the matching H3 section heading below it), only the LAST occurrence
// receives the id so clicks land on the actual section, not the jump card.
export default function addAnchorIds(html: string): string {
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
  return out;
}
