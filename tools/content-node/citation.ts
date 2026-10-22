/**
 * Citations, as content-service's EventCitation and StaticCitation write
 * them: a pathway's from its own data, a paper's from Europe PMC. The text
 * here is Java's, quirks included -- three authors joined " ," then " & ",
 * the default author line, the placeholders a paper without a journal or a
 * volume gets.
 */
import type { DomainEntity } from './domain.ts';

const DEFAULT_AUTHOR = 'The Reactome Consortium';
// A date of null is written as Java writes one: "null".
const NOTE = (date: string | null) => `Provided by Reactome. Citation Accessed on ${String(date)}`;

/** Java's DateFormatSymbols short months, for Citation.setMonth. */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Citation.setMonth: Integer.parseInt of the text, a month only for 1 to 12;
 * text that is no int is Java's NumberFormatException.
 */
function citationMonth(text: string) {
  const month = /^[+-]?\d+$/.test(String(text)) ? Number(text) : NaN;
  if (!(month >= -2147483648 && month <= 2147483647))
    throw javaFailure(`For input string: "${text}"`);
  return month > 0 && month <= 12 ? SHORT_MONTHS[month - 1] : null;
}

/**
 * What Java throws for its GlobalExceptionHandler to answer with a 500: a
 * NullPointerException as "Something unexpected happened", anything else
 * with its own message (javaFailure).
 */
function unexpected(message: string) {
  return Object.assign(new Error(message), { unexpected: true });
}
function javaFailure(message: string) {
  return Object.assign(new Error(message), { javaMessage: message });
}

/** String.substring's StringIndexOutOfBoundsException, as JDK 11 words it. */
function substring(text: string, begin: number, end: number) {
  if (end > text.length) throw javaFailure(`begin ${begin}, end ${end}, length ${text.length}`);
  return text.slice(begin, end);
}

/** The class Jackson reads a JSON value as, into a Map<String, Object>. */
function javaClass(value: unknown) {
  if (typeof value === 'string') return 'java.lang.String';
  if (typeof value === 'boolean') return 'java.lang.Boolean';
  if (Array.isArray(value)) return 'java.util.ArrayList';
  if (typeof value === 'object') return 'java.util.LinkedHashMap';
  if (!Number.isInteger(value)) return 'java.lang.Double';
  // A JSON value that is none of those: an integer.
  const number = value as number;
  if (number >= -2147483648 && number <= 2147483647) return 'java.lang.Integer';
  return Number.isSafeInteger(number) ? 'java.lang.Long' : 'java.math.BigInteger';
}

/** A cast of a JSON value as Java's checkcast does it: null passes, a misfit is JDK 11's ClassCastException. */
function javaCast(value: unknown, target: string, fits: (value: unknown) => boolean) {
  if (value === null || value === undefined || fits(value)) return;
  const from = javaClass(value);
  throw javaFailure(
    `class ${from} cannot be cast to class ${target} (${from} and ${target} are in module java.base of loader 'bootstrap')`
  );
}
const isString = (value: unknown) => typeof value === 'string';
const isMap = (value: unknown) => typeof value === 'object' && !Array.isArray(value);

/**
 * The casts StaticCitation's toBibtex/toRIS (by name) and toText (by full
 * name) make of Europe PMC's authors -- outside Java's try, so a misfit is
 * GlobalExceptionHandler's 500 rather than "unable to fetch": each author to
 * a Map and its names to String -- by name for BibTeX and RIS, the full
 * name for text -- one author at a time; a null author is the
 * NullPointerException of author.get.
 */
function checkStaticAuthors(authors: readonly unknown[] | null | undefined, ext: string) {
  if (!authors?.length) return;
  for (const author of authors) {
    javaCast(author, 'java.util.Map', isMap);
    if (author === null) throw unexpected('a null author');
    // A map: javaCast refused anything else.
    const names = author as Record<string, unknown>;
    if (ext === 'bib' || ext === 'ris') {
      javaCast(names['lastName'], 'java.lang.String', isString);
      javaCast(
        'firstName' in names ? names['firstName'] : names['initials'],
        'java.lang.String',
        isString
      );
    } else javaCast(names['fullName'], 'java.lang.String', isString);
  }
}

/** An author as a citation lists one: an event's by initials, Europe PMC's by full name. */
interface Author {
  lastName?: string | null | undefined;
  firstName?: string | null | undefined;
  initials?: string;
  fullName?: string | null;
}

/**
 * Java's Citation, as the export endpoints read it. Each builder adds the
 * fields in its own order, the order that reaches the answer; a type lists
 * them and does not change it.
 */
export interface Citation {
  id: string;
  title: string;
  year?: string | null;
  /** Undefined where citationMonth reads no month: left out, as Java leaves it. */
  month?: string | null | undefined;
  doi?: string | null;
  urls?: string[];
  authors?: Author[] | null;
  release?: string;
  pages?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  journal?: string | null;
  number?: string | null;
  volume?: string | null;
  issn?: string | null;
}

/**
 * CitationController.getEventCitationObject, given the event: its name, the
 * release year and -- from the wrong character of the date, as Java takes
 * it -- month, a pathway's DOI or else its page, the release, and the authors
 * of its authored edits, else its creator, else its reviewers, initials
 * dotted as String.join(".", initial.split("")) dots them. What Java
 * throws on -- no name or release date, a short or non-numeric one, a
 * person with no initial -- throws the same.
 */
export function citationOfEvent(
  event: Pick<DomainEntity, 'properties' | 'fields'>,
  raw: string,
  release: string,
  isPathway: boolean
) {
  const props = event.properties;
  // The Citation constructor's own check.
  if (props['displayName'] == null) throw javaFailure('Title or id can not be null');
  if (props['releaseDate'] == null) throw unexpected('an event with no release date');
  const date = String(props['releaseDate']);
  const citation: Citation & { urls: string[] } = {
    id: raw,
    // The graph's text properties, as the model types them.
    title: props['displayName'] as string,
    year: substring(date, 0, 4),
    month: citationMonth(substring(date, 6, 7)),
    doi: null,
    urls: [],
    authors: null,
  };
  const doi = props['doi'] as string | null | undefined;
  if (isPathway && doi) {
    citation.doi = doi;
    citation.urls.push(`https://doi.org/${doi}`);
  } else citation.urls.push(`https://reactome.org/content/detail/${raw}`);
  citation.release = release;
  // InstanceEdits, and their authors' Persons, as the model types the fields.
  const fields = event.fields as {
    authored?: DomainEntity[] | null;
    created?: DomainEntity | null;
    reviewed?: DomainEntity[] | null;
  };
  const edits = fields.authored?.length
    ? fields.authored
    : fields.created
      ? [fields.created]
      : fields.reviewed?.length
        ? fields.reviewed
        : null;
  if (edits) {
    citation.authors = [];
    for (const edit of edits)
      for (const person of (edit.fields['author'] as DomainEntity[] | null | undefined) ?? []) {
        const { surname, initial, firstname } = person.properties as {
          surname?: string | null;
          initial?: string | null;
          firstname?: string | null;
        };
        if (initial == null) throw unexpected('a person with no initial');
        citation.authors.push({
          lastName: surname,
          initials: `${[...String(initial)].join('.')}.`,
          firstName: firstname,
        });
      }
  }
  return citation;
}

/** A value joined into text as Java joins it: a missing one is "null". */
const java = (value: string | null | undefined) =>
  value === null || value === undefined ? 'null' : value;

const byName = (author: Author) =>
  `${java(author.lastName)}, ${java('firstName' in author ? author.firstName : author.initials)}`;

function ris(
  citation: Citation,
  type: string,
  date: string | null,
  extra: [string, unknown][] = []
) {
  let text = `${NOTE(date)}\n\nTY  - ${type}\nTI  - ${citation.title}\n`;
  for (const author of citation.authors ?? []) text += `AU  - ${byName(author)}\n`;
  text += `AN  - ${citation.id}\n`;
  if (citation.doi != null) text += `DO  - ${citation.doi}\n`;
  for (const url of citation.urls ?? []) text += `UR  - ${url.trim()}\n`;
  if (citation.year != null) {
    text += `PY  - ${citation.year}\n`;
    if (citation.month != null) text += `DA  - ${citation.year}/${citation.month}//\n`;
  }
  for (const [tag, value] of extra) if (value != null) text += `${tag}  - ${String(value)}\n`;
  return `${text}ER  - \n`;
}

function bibtex(
  citation: Citation,
  kind: string,
  date: string | null,
  middle: [string, unknown][]
) {
  let text = `@${kind}{${citation.id},\nTitle = {${citation.title}},\n`;
  for (const [name, value] of middle)
    if (value !== undefined) text += `${name} = {${String(value)}},\n`;
  return `${text}Note = {${NOTE(date)}},\n}`;
}

/** EventCitation.toText, toBibtex or toRIS, as `ext` (bib, ris, anything else text) picks. */
export function formatEventCitation(citation: Citation, ext: string, date: string) {
  const authors = citation.authors?.length ? citation.authors : null;
  if (ext === 'bib')
    return bibtex(citation, 'misc', date, [
      ['Author', authors ? authors.map(byName).join(' and ') : DEFAULT_AUTHOR],
      ['Year', citation.year ?? undefined],
      ['Month', citation.month ?? undefined],
      ['DOI', citation.doi ?? undefined],
      ['URL', citation.urls?.length ? citation.urls[0] : undefined],
    ]);
  if (ext === 'ris') return ris(citation, 'ELEC', date);
  return `Pathway Citation: ${eventText(citation, date)}\nImage Citation: ${imageText(citation, date)}`;
}

/** EventCitation.eventCitation: authors by their initials, the year, then the common part. */
export function eventText(citation: Citation, date: string) {
  let text = DEFAULT_AUTHOR;
  if (citation.authors?.length) {
    const names = citation.authors.map(
      (author) => `${java(author.lastName)}, ${java(author.initials)}`
    );
    // One at least: the authors' length was checked.
    text = names.at(-1) as string;
    if (names.length > 1) text = `${names.slice(0, -1).join(' ,')} & ${text}`;
  }
  if (citation.year != null) text += ` (${citation.year}). `;
  return text + commonText(citation, date);
}

export function imageText(citation: Citation, date: string) {
  return `Image Citation for ${commonText(citation, date)}`;
}

function commonText(citation: Citation, date: string) {
  let text = `${citation.title}. `;
  if (citation.release != null) text += `Reactome, ${citation.release}, `;
  if (citation.urls?.length) text += `${citation.urls.join(', ')} `;
  return `${text}(${date})`;
}

/** StaticCitation.toText, toBibtex or toRIS. `date` null is no "Provided by" line. */
export function formatStaticCitation(citation: Citation, ext: string, date: string | null) {
  checkStaticAuthors(citation.authors, ext);
  if (ext === 'bib')
    return bibtex(citation, 'article', date, [
      [
        'Author',
        citation.authors?.length
          ? citation.authors.map(byName).join(' and ')
          : 'No authors specified',
      ],
      ['Journal', citation.journal ?? 'No journal specified'],
      ['Number', citation.number ?? undefined],
      ['Volume', citation.volume ?? 'No volume specified'],
      ['ISSN', citation.issn ?? undefined],
      ['Pages', citation.pages ?? undefined],
      ['Year', citation.year ?? 'No year specified'],
      ['Month', citation.month ?? undefined],
      ['DOI', citation.doi ?? undefined],
      ['URL', citation.urls?.length ? citation.urls[0] : undefined],
    ]);
  if (ext === 'ris')
    return ris(citation, 'JOUR', date, [
      ['JO', citation.journal],
      ['IS', citation.number],
      ['VL', citation.volume],
      ['SN', citation.issn],
      ['SP', citation.pages],
    ]);
  let text = date != null ? `${NOTE(date)}\n\n` : '';
  if (citation.authors?.length)
    text += `${citation.authors.map((author) => java(author.fullName)).join(', ')}. `;
  text += `${citation.title} `;
  if (citation.journal != null) text += `${citation.journal}. `;
  if (citation.year != null) {
    text += citation.year;
    if (citation.month != null) text += ` ${citation.month}`;
  }
  if (citation.volume != null) {
    text += `;${citation.volume}`;
    if (citation.number != null) text += `(${citation.number})`;
    text += ' ';
  }
  if (citation.pages != null) text += `${citation.pages}. `;
  if (citation.doi != null) text += `doi: ${citation.doi}. `;
  if (citation.pmid != null) text += `PubMed PMID: ${citation.pmid}. `;
  if (citation.pmcid != null) text += `PubMed Central PMCID: ${citation.pmcid}. `;
  return text;
}

/**
 * Object.toString of a value Jackson read: a map {a=1, b=2}, a list [x, y],
 * anything else as itself. A null is the NullPointerException Java's
 * toString() on it is.
 */
function javaString(value: unknown): string {
  if (value === null || value === undefined) throw new Error('toString of null');
  const inner = (item: unknown) => (item === null ? 'null' : javaString(item));
  if (Array.isArray(value)) return `[${value.map(inner).join(', ')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${key}=${inner(item)}`)
      .join(', ')}}`;
  return String(value);
}

/** Java's cast to Map: null passes, anything but an object is its ClassCastException. */
function asMap(value: unknown) {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value)))
    throw new Error('not a map');
  return value as Record<string, unknown> | null;
}

/**
 * CitationController.getStaticCitationObject: Europe PMC's first result,
 * read field by field as Java reads it. Anything Java would fail on -- no
 * result, no id or title, a month that is no int -- throws, and the caller
 * answers as Java's catch does.
 */
export function staticCitationFrom(answer: unknown) {
  // What Java reads of the answer. Anything else fails here, as Java's
  // reading does: a result that is no object has no id.
  const map = (answer as { resultList?: { result?: Record<string, unknown>[] } } | null | undefined)
    ?.resultList?.result?.[0];
  if (map?.['id'] == null || map['title'] == null)
    throw new Error('no citation in Europe PMC answer');
  const journalInfo = 'journalInfo' in map ? asMap(map['journalInfo']) : null;
  const journal = journalInfo && 'journal' in journalInfo ? asMap(journalInfo['journal']) : null;
  const citation: Citation = { id: javaString(map['id']), title: javaString(map['title']) };
  if ('pageInfo' in map) citation.pages = javaString(map['pageInfo']);
  if ('pmid' in map) citation.pmid = javaString(map['pmid']);
  if ('pmcid' in map) citation.pmcid = javaString(map['pmcid']);
  if (journal && 'title' in journal) citation.journal = javaString(journal['title']);
  if (journalInfo && 'yearOfPublication' in journalInfo)
    citation.year = javaString(journalInfo['yearOfPublication']);
  if (journalInfo && 'monthOfPublication' in journalInfo)
    citation.month = citationMonth(javaString(journalInfo['monthOfPublication']));
  if (journalInfo && 'issue' in journalInfo) citation.number = javaString(journalInfo['issue']);
  if (journalInfo && 'volume' in journalInfo) citation.volume = javaString(journalInfo['volume']);
  if (journal && 'issn' in journal) citation.issn = javaString(journal['issn']);
  if ('doi' in map && map['doi'] != null) {
    citation.doi = javaString(map['doi']);
    citation.urls = [`https://doi.org/${citation.doi}`];
  }
  if ('authorList' in map) {
    const authorList = asMap(map['authorList']);
    if (authorList === null) throw new Error('authorList is null');
    if ('author' in authorList) {
      const authors: unknown = authorList['author'];
      if (authors !== null && !Array.isArray(authors)) throw new Error('author is not a list');
      // Unchecked: formatStaticCitation casts each as Java does
      // (checkStaticAuthors) before any is read.
      citation.authors = authors as Author[] | null;
    }
  }
  return citation;
}
