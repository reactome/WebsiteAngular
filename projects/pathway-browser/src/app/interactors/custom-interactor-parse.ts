/**
 * Reading a reader's own interactions, in the browser.
 *
 * The service will do this too -- `POST interactors/upload/tuple/content` -- but
 * doing it there means the data leaves the machine it came from, is written to
 * `ContentService/custom/<token>.bin`, and is addressed by a token that then
 * appears in the page's address. Traced 2026-09-15: a fresh upload read back
 * with a plain request carrying no session, a store of 323 files whose oldest is
 * from 2019, and nothing expiring.
 *
 * None of that is needed to draw a list of pairs on a diagram, so for a file or
 * a paste this parses in the page and no request is made at all. The URL and
 * PSICQUIC options still go to the service, because fetching an arbitrary origin
 * from a page is not something a browser will do.
 *
 * The format is the service's, matched deliberately so the same file works
 * either way. Measured against beta's ContentService rather than inferred:
 *
 *   - a header line `#ID_A<tab>ID_B`
 *   - then two identifiers per line
 *   - a third column is refused outright
 *   - without the header, the first pair is read as the header and dropped,
 *     which the service reports as a warning rather than an error
 */
import { InteractorEntity, Interactors } from './model/interactor.model';

/** What the service gives an interaction it was told nothing about. */
const ASSUMED_SCORE = 1;

/** Where an accession can be looked up, matching what the service returns. */
const UNIPROT = 'http://www.uniprot.org/uniprot/';

export interface ParsedInteractions {
  /** Drawable, in the shape the overlay already consumes. */
  interactors: Interactors;
  /** Accepted, but the reader should know. */
  warnings: string[];
  /** Nothing usable was found, and why. */
  error?: string;
}

/**
 * Split a line into fields.
 *
 * Tab first, because that is the format. A line with no tab falls back to
 * whitespace: a reader pasting out of a spreadsheet column or a terminal gets
 * spaces, and refusing that would be pedantry about a separator rather than
 * about the data.
 */
function fields(line: string): string[] {
  const parts = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function parseCustomInteractions(text: string, resource: string): ParsedInteractions {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      interactors: { entities: [], resource },
      warnings,
      error: 'There is nothing to read.',
    };
  }

  // The header, if there is one. Said rather than assumed, because the service
  // treats its absence as a warning and silently eats a pair -- the one part of
  // this format that costs a reader data without telling them.
  const hasHeader = lines[0].startsWith('#');
  if (hasHeader) {
    const columns = fields(lines[0].slice(1));
    if (columns.length > 2) {
      return {
        interactors: { entities: [], resource },
        warnings,
        error: `Two columns only: ID_A and ID_B. This header has ${columns.length}.`,
      };
    }
  } else {
    warnings.push(
      'No "#ID_A\tID_B" header, so the first line was read as data rather than as a header.'
    );
  }

  const byAccession = new Map<
    string,
    { acc: string; id: number; score: number; accURL: string }[]
  >();
  const malformed: number[] = [];
  let id = 0;

  lines.slice(hasHeader ? 1 : 0).forEach((line, index) => {
    const [a, b, ...rest] = fields(line);
    if (!a || !b || rest.length > 0) {
      // Reported by line number the reader can see, counting the header.
      malformed.push(index + (hasHeader ? 2 : 1));
      return;
    }
    // Both directions, so an interaction is found whichever partner the diagram
    // happens to draw. The service does the same: a two-line file comes back as
    // four interactors.
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const partners = byAccession.get(from) ?? [];
      partners.push({ acc: to, id: ++id, score: ASSUMED_SCORE, accURL: UNIPROT + to });
      byAccession.set(from, partners);
    }
  });

  if (malformed.length > 0) {
    const shown = malformed.slice(0, 5).join(', ');
    warnings.push(
      `Skipped ${malformed.length} line${malformed.length === 1 ? '' : 's'} that did not hold exactly two identifiers (${shown}${malformed.length > 5 ? ', …' : ''}).`
    );
  }

  const entities: InteractorEntity[] = [...byAccession.entries()].map(([acc, interactors]) => ({
    acc,
    count: interactors.length,
    interactors,
  })) as InteractorEntity[];

  if (entities.length === 0) {
    return {
      interactors: { entities: [], resource },
      warnings,
      error: 'No line held two identifiers separated by a tab.',
    };
  }

  return { interactors: { entities, resource }, warnings };
}
