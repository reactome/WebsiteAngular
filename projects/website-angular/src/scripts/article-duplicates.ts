/**
 * Articles in one listing that share a title.
 *
 * The spotlight folder held 40 `blogpost-N` scrape leftovers beside the real
 * articles, so the listing showed half its spotlights twice and nothing
 * noticed. Titles are compared ignoring case, spacing and punctuation.
 */
export function duplicateArticles(items: { slug: string; title: unknown }[]): string[][] {
  const byTitle = new Map<string, string[]>();
  for (const { slug, title } of items) {
    const key = String(title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), slug]);
  }
  return [...byTitle.values()].filter((slugs) => slugs.length > 1);
}
