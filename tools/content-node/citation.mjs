/**
 * Citations, as content-service's EventCitation and StaticCitation write
 * them: a pathway's from its own data, a paper's from Europe PMC. The text
 * here is Java's, quirks included -- three authors joined " ," then " & ",
 * the default author line, the placeholders a paper without a journal or a
 * volume gets.
 */
const DEFAULT_AUTHOR = 'The Reactome Consortium';
const NOTE = (date) => `Provided by Reactome. Citation Accessed on ${date}`;

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
function citationMonth(text) {
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
function unexpected(message) {
  return Object.assign(new Error(message), { unexpected: true });
}
function javaFailure(message) {
  return Object.assign(new Error(message), { javaMessage: message });
}

/** String.substring's StringIndexOutOfBoundsException, as JDK 11 words it. */
function substring(text, begin, end) {
  if (end > text.length) throw javaFailure(`begin ${begin}, end ${end}, length ${text.length}`);
  return text.slice(begin, end);
}

/** The class Jackson reads a JSON value as, into a Map<String, Object>. */
function javaClass(value) {
  if (typeof value === 'string') return 'java.lang.String';
  if (typeof value === 'boolean') return 'java.lang.Boolean';
  if (Array.isArray(value)) return 'java.util.ArrayList';
  if (typeof value === 'object') return 'java.util.LinkedHashMap';
  if (!Number.isInteger(value)) return 'java.lang.Double';
  if (value >= -2147483648 && value <= 2147483647) return 'java.lang.Integer';
  return Number.isSafeInteger(value) ? 'java.lang.Long' : 'java.math.BigInteger';
}

/** A cast of a JSON value as Java's checkcast does it: null passes, a misfit is JDK 11's ClassCastException. */
function javaCast(value, target, fits) {
  if (value === null || value === undefined || fits(value)) return;
  const from = javaClass(value);
  throw javaFailure(
    `class ${from} cannot be cast to class ${target} (${from} and ${target} are in module java.base of loader 'bootstrap')`
  );
}
const isString = (value) => typeof value === 'string';
const isMap = (value) => typeof value === 'object' && !Array.isArray(value);

/**
 * The casts StaticCitation's toBibtex/toRIS (by name) and toText (by full
 * name) make of Europe PMC's authors -- outside Java's try, so a misfit is
 * GlobalExceptionHandler's 500 rather than "unable to fetch": each author to
 * a Map and its names to String -- by name for BibTeX and RIS, the full
 * name for text -- one author at a time; a null author is the
 * NullPointerException of author.get.
 */
function checkStaticAuthors(authors, ext) {
  if (!authors?.length) return;
  for (const author of authors) {
    javaCast(author, 'java.util.Map', isMap);
    if (author === null) throw unexpected('a null author');
    if (ext === 'bib' || ext === 'ris') {
      javaCast(author.lastName, 'java.lang.String', isString);
      javaCast(
        'firstName' in author ? author.firstName : author.initials,
        'java.lang.String',
        isString
      );
    } else javaCast(author.fullName, 'java.lang.String', isString);
  }
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
export function citationOfEvent(event, raw, release, isPathway) {
  const props = event.properties;
  // The Citation constructor's own check.
  if (props.displayName == null) throw javaFailure('Title or id can not be null');
  if (props.releaseDate == null) throw unexpected('an event with no release date');
  const date = String(props.releaseDate);
  const citation = {
    id: raw,
    title: props.displayName,
    year: substring(date, 0, 4),
    month: citationMonth(substring(date, 6, 7)),
    doi: null,
    urls: [],
    authors: null,
  };
  if (isPathway && props.doi) {
    citation.doi = props.doi;
    citation.urls.push(`https://doi.org/${props.doi}`);
  } else citation.urls.push(`https://reactome.org/content/detail/${raw}`);
  citation.release = release;
  const fields = event.fields;
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
      for (const person of edit.fields?.author ?? []) {
        const { surname, initial, firstname } = person.properties;
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
const java = (value) => (value === null || value === undefined ? 'null' : value);

const byName = (author) =>
  `${java(author.lastName)}, ${java('firstName' in author ? author.firstName : author.initials)}`;

function ris(citation, type, date, extra = []) {
  let text = `${NOTE(date)}\n\nTY  - ${type}\nTI  - ${citation.title}\n`;
  for (const author of citation.authors ?? []) text += `AU  - ${byName(author)}\n`;
  text += `AN  - ${citation.id}\n`;
  if (citation.doi != null) text += `DO  - ${citation.doi}\n`;
  for (const url of citation.urls ?? []) text += `UR  - ${url.trim()}\n`;
  if (citation.year != null) {
    text += `PY  - ${citation.year}\n`;
    if (citation.month != null) text += `DA  - ${citation.year}/${citation.month}//\n`;
  }
  for (const [tag, value] of extra) if (value != null) text += `${tag}  - ${value}\n`;
  return `${text}ER  - \n`;
}

function bibtex(citation, kind, date, middle) {
  let text = `@${kind}{${citation.id},\nTitle = {${citation.title}},\n`;
  for (const [name, value] of middle) if (value !== undefined) text += `${name} = {${value}},\n`;
  return `${text}Note = {${NOTE(date)}},\n}`;
}

/** EventCitation.toText, toBibtex or toRIS, as `ext` (bib, ris, anything else text) picks. */
export function formatEventCitation(citation, ext, date) {
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
export function eventText(citation, date) {
  let text = DEFAULT_AUTHOR;
  if (citation.authors?.length) {
    const names = citation.authors.map(
      (author) => `${java(author.lastName)}, ${java(author.initials)}`
    );
    text = names.at(-1);
    if (names.length > 1) text = `${names.slice(0, -1).join(' ,')} & ${text}`;
  }
  if (citation.year != null) text += ` (${citation.year}). `;
  return text + commonText(citation, date);
}

export function imageText(citation, date) {
  return `Image Citation for ${commonText(citation, date)}`;
}

function commonText(citation, date) {
  let text = `${citation.title}. `;
  if (citation.release != null) text += `Reactome, ${citation.release}, `;
  if (citation.urls?.length) text += `${citation.urls.join(', ')} `;
  return `${text}(${date})`;
}

/** StaticCitation.toText, toBibtex or toRIS. `date` null is no "Provided by" line. */
export function formatStaticCitation(citation, ext, date) {
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
function javaString(value) {
  if (value === null || value === undefined) throw new Error('toString of null');
  const inner = (item) => (item === null ? 'null' : javaString(item));
  if (Array.isArray(value)) return `[${value.map(inner).join(', ')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${key}=${inner(item)}`)
      .join(', ')}}`;
  return String(value);
}

/** Java's cast to Map: null passes, anything but an object is its ClassCastException. */
function asMap(value) {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value)))
    throw new Error('not a map');
  return value;
}

/**
 * CitationController.getStaticCitationObject: Europe PMC's first result,
 * read field by field as Java reads it. Anything Java would fail on -- no
 * result, no id or title, a month that is no int -- throws, and the caller
 * answers as Java's catch does.
 */
export function staticCitationFrom(answer) {
  const map = answer?.resultList?.result?.[0];
  if (!map || map.id == null || map.title == null)
    throw new Error('no citation in Europe PMC answer');
  const journalInfo = 'journalInfo' in map ? asMap(map.journalInfo) : null;
  const journal = journalInfo && 'journal' in journalInfo ? asMap(journalInfo.journal) : null;
  const citation = { id: javaString(map.id), title: javaString(map.title) };
  if ('pageInfo' in map) citation.pages = javaString(map.pageInfo);
  if ('pmid' in map) citation.pmid = javaString(map.pmid);
  if ('pmcid' in map) citation.pmcid = javaString(map.pmcid);
  if (journal && 'title' in journal) citation.journal = javaString(journal.title);
  if (journalInfo && 'yearOfPublication' in journalInfo)
    citation.year = javaString(journalInfo.yearOfPublication);
  if (journalInfo && 'monthOfPublication' in journalInfo)
    citation.month = citationMonth(javaString(journalInfo.monthOfPublication));
  if (journalInfo && 'issue' in journalInfo) citation.number = javaString(journalInfo.issue);
  if (journalInfo && 'volume' in journalInfo) citation.volume = javaString(journalInfo.volume);
  if (journal && 'issn' in journal) citation.issn = javaString(journal.issn);
  if ('doi' in map && map.doi != null) {
    citation.doi = javaString(map.doi);
    citation.urls = [`https://doi.org/${citation.doi}`];
  }
  if ('authorList' in map) {
    const authorList = asMap(map.authorList);
    if (authorList === null) throw new Error('authorList is null');
    if ('author' in authorList) {
      const authors = authorList.author;
      if (authors !== null && !Array.isArray(authors)) throw new Error('author is not a list');
      citation.authors = authors;
    }
  }
  return citation;
}
