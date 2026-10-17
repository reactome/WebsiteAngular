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
export function citationMonth(text) {
  if (!/^[+-]?\d+$/.test(String(text)))
    throw Object.assign(new Error(`a month that is no int: ${text}`), { unexpected: true });
  const month = Number(text);
  return month > 0 && month <= 12 ? SHORT_MONTHS[month - 1] : null;
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

/** Object.toString of a JSON value, as Java's on Jackson's map writes it. */
const javaString = (value) => (value === null || value === undefined ? value : String(value));

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
  const journalInfo = map.journalInfo ?? null;
  const journal = journalInfo?.journal ?? null;
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
  if (map.authorList && 'author' in map.authorList) citation.authors = map.authorList.author;
  return citation;
}
