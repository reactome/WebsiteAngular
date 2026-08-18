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
// MediaWiki-style anchor encoding, which the wiki-sourced userguide pages use
// in their tables of contents: spaces become underscores and any character not
// legal in an id is percent-encoded with "." in place of "%". So the heading
// "Gene Set/Mutation Analysis" is linked as "#Gene_Set.2FMutation_Analysis",
// and "...Interaction (FI) Network" as "...Interaction_.28FI.29_Network".
// Encoding runs over UTF-8 bytes so non-ASCII headings encode correctly too.
function mediaWikiAnchor(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\-.:]/g, (ch) =>
      Array.from(new TextEncoder().encode(ch))
        .map((b) => '.' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('')
    );
}

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
  //
  // Fragments pass 1 has already placed are off limits: it deliberately gives
  // only the LAST duplicate heading the id, and re-adding the same id here
  // would put it back on the jump card above -- browsers scroll to the first
  // match, which is the behaviour pass 1 exists to avoid.
  const assigned = new Set(lastByHref.keys());
  const fragments = new Set<string>();
  for (const m of out.matchAll(/href="#([^"]+)"/g)) fragments.add(m[1]);
  if (fragments.size === 0) return out;

  out = out.replace(/<(h[1-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (full, tag, attrs, inner) => {
    // Skip headings that already have an id (pass 1 added one).
    if (attrs && /\bid=/.test(attrs)) return full;
    // Skip headings whose content is itself a link (pass 1 would have
    // handled them if the link target matched).
    // Use the heading's plain text to compute the slug.
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text) return full;
    // Try the plain slug first, then the MediaWiki encoding, so a page can
    // mix both conventions.
    const slug = [text.replace(/\s+/g, '_'), mediaWikiAnchor(text)].find(
      (s) => fragments.has(s) && !assigned.has(s)
    );
    if (!slug) return full;
    assigned.add(slug);
    return `<${tag}${attrs || ''} id="${slug}">${inner}</${tag}>`;
  });

  // Pass 3: fragments that still resolve to nothing.
  //
  // The wiki-sourced pages were exported with their tables of contents intact
  // but their explicit anchor targets dropped, so links like
  // "#Structural_Variants_Visualization" and "#scRNA_seq" name no heading and
  // no slug of one. The link's own text does name the section, though
  // ("3.6. Visualization of Structural Variants in the Context of Reactome
  // Pathways"), so strip the leading numbering and match that against the
  // headings. Comparison ignores case and punctuation, which also picks up
  // headings that differ from their fragment only in case.
  //
  // This runs last and only over fragments nothing else resolved, so it can
  // never move an id that passes 1 and 2 placed correctly.
  const unresolved = [...fragments].filter((f) => !assigned.has(f));
  if (unresolved.length === 0) return out;

  const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const linkText = new Map<string, string>();
  for (const m of out.matchAll(/<a\s[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/^[\d.\s]+/, '')
      .trim();
    if (text && !linkText.has(m[1])) linkText.set(m[1], text);
  }

  const wanted = new Map<string, string>();
  for (const f of unresolved) {
    // The fragment itself may already be a near-match for a heading (the
    // case-only mismatches); otherwise fall back to the link's text.
    for (const key of [f.replace(/_/g, ' '), linkText.get(f)]) {
      if (key) wanted.set(loose(key), f);
    }
  }

  return out.replace(/<(h[1-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (full, tag, attrs, inner) => {
    if (attrs && /\bid=/.test(attrs)) return full;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const frag = text && wanted.get(loose(text));
    if (!frag || assigned.has(frag)) return full;
    assigned.add(frag);
    return `<${tag}${attrs || ''} id="${frag}">${inner}</${tag}>`;
  });
}
