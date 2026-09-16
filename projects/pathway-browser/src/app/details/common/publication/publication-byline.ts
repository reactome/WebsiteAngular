/**
 * Assembling a byline out of a publication's raw `authorName` attribute.
 *
 * The shape differs by backend: the public content service sends one pre-composed string (or
 * omits the attribute entirely), while the curation graph behind GraphContentService sends one
 * entry per author, each spelled "Surname, Initials". Kept as plain functions so the two forms
 * can be pinned down in tests without standing the component up.
 */

/** The raw attribute as a list of non-empty, trimmed entries. */
export function authorNameEntries(raw: string | string[] | undefined): string[] {
  return (Array.isArray(raw) ? raw : [raw])
    .map((name) => name?.trim())
    .filter((name): name is string => !!name);
}

/**
 * The byline to render when a publication has no structured `author` list.
 *
 * A single string is already composed, so it passes through untouched -- commas and all.
 * Only the per-author array form needs assembling: each entry's own "Surname, Initials" comma
 * is dropped and authors are separated by one instead, which is how a byline built from
 * structured authors reads (see PublicationComponent's toAuthorView).
 */
export function composeAuthorByline(raw: string | string[] | undefined): string {
  if (!Array.isArray(raw)) return raw?.trim() ?? '';
  return authorNameEntries(raw)
    .map((name) =>
      name
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ')
    )
    .join(', ');
}
