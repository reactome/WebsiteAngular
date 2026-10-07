/**
 * The interactors on the diagram, as a file.
 *
 * `RELEASE-TESTING.md:118` — the old browser offers this beside its slider and we
 * did not. It exports exactly what the reader can see: the interactions above the
 * confidence threshold, for the entities they opened. Not what the resource
 * returned, and not what the diagram had room to draw.
 *
 * TSV, following `molecule-download-table` — the existing client-side export of a
 * table from this same panel. The CSVs elsewhere in this app all come from the
 * analysis service, which is the wrong precedent for something assembled in the
 * browser. Scores and gene names need no quoting in TSV, which is the other
 * reason.
 */

/** One interaction, in the shape the graph actually holds. */
export interface ExportableInteraction {
  acc?: string;
  alias?: string;
  score?: number;
  evidences?: number;
  entity?: string;
}

/** The columns, in the order the interactors table already presents them. */
const COLUMNS = ['entity', 'interactor', 'accession', 'score', 'evidences'] as const;

/**
 * A tab is the separator, so it cannot appear in a value.
 *
 * Aliases come from a database and a newline or tab in one would silently shift
 * every later column of that row. Replaced with a space rather than escaped,
 * because TSV has no agreed escape and a reader opening this in a spreadsheet
 * would get the escape rather than the name.
 */
function clean(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

export function interactorsToTsv(interactions: ExportableInteraction[]): string {
  const rows = [COLUMNS.join('\t')];
  for (const interaction of interactions) {
    rows.push(
      [
        clean(interaction.entity),
        clean(interaction.alias ?? interaction.acc),
        clean(interaction.acc),
        clean(interaction.score),
        clean(interaction.evidences),
      ].join('\t')
    );
  }
  // A trailing newline, so the last row is a row rather than a fragment.
  return rows.join('\n') + '\n';
}

/** What to call the file, naming what it came from. */
export function interactorFilename(pathwayStId: string | null, resource: string | null): string {
  const parts = [pathwayStId, resource].filter(Boolean).join('] [');
  return parts ? `Interactors [${parts}].tsv` : 'Interactors.tsv';
}
