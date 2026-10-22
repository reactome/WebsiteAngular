/**
 * The citation endpoints (spec 014, research R1, a family): /citation/*,
 * CitationController's -- a pathway's or a paper's citation, and its export
 * as BibTeX, RIS or text -- with the helpers only they use. Moved unchanged
 * from service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import { inDepthId } from './objects.ts';
import { read } from './graph.ts';
import type { MappedRow } from './domain.ts';
import { enhancedQuery, isA, mapResult } from './domain.ts';
import { databaseVersion } from './release.ts';
import {
  citationOfEvent,
  eventText,
  formatEventCitation,
  formatStaticCitation,
  imageText,
  staticCitationFrom,
} from './citation.ts';
import { javaError, unexpectedFailure } from './answers.ts';
import type { Failure } from './answers.ts';
import { hashSetOf } from './java-text.ts';
import { URLSearchParams } from 'node:url';
import { settings } from './settings.ts';
import { pathId, queryValues, rawSegment, requiredString, springBoolean } from './spring.ts';

/**
 * CitationController.getEventCitationObject: an event's citation from its
 * enhanced object (graph-core's findEnhancedObjectById); undefined for an id
 * that is no event. What goes into it is citationOfEvent's.
 */
async function eventCitationFor(raw: string) {
  const id = inDepthId(raw);
  if (!id) return undefined;
  const [row] = await read<MappedRow>(
    enhancedQuery({
      idType: id.idType,
      summarise: false,
      includeDisease: true,
      outgoingOnly: false,
    }),
    { id: id.id }
  );
  if (!row) return undefined;
  const event = mapResult(row);
  if (!isA(event.schemaClass, 'Event')) return undefined;
  const release = String((await databaseVersion({ params: {}, query: {} })).body);
  return citationOfEvent(event, raw, release, isA(event.schemaClass, 'Pathway'));
}

/**
 * An event's citation, or Java's GlobalExceptionHandler 500 when Java's
 * getEventCitationObject throws -- no release date, or a person with no
 * initial.
 */
async function eventCitationOrFailure(request: Request, raw: string) {
  try {
    return { citation: await eventCitationFor(raw) };
  } catch (failure) {
    return { failure: citationFailure(request, failure) };
  }
}

/** GlobalExceptionHandler's 500 for what citation.ts throws as Java does; anything else is ours. */
function citationFailure(request: Request, caught: unknown) {
  const failure = caught as Failure;
  if (failure.unexpected) return unexpectedFailure(request);
  if (failure.javaMessage)
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', failure.javaMessage);
  throw failure;
}

/** A header value as Tomcat writes it: past Latin-1 a '?', a control character a space. */
function tomcatHeader(text) {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0);
      if (code > 0xff) return '?';
      return (code < 0x20 && char !== '\t') || code === 0x7f ? ' ' : char;
    })
    .join('');
}

/** The two citations of /citation/pathway/{id}, in the order Java's HashMap writes them. */
export function pathwayCitations(citation, date) {
  const texts = {
    pathwayCitation: eventText(citation, date),
    imageCitation: imageText(citation, date),
  };
  const body = {};
  for (const key of hashSetOf(['pathwayCitation', 'imageCitation']).keys()) body[key] = texts[key];
  return body;
}

/** CitationController.getStaticCitationObject: Europe PMC's record of a PubMed id, or undefined. */
async function staticCitationFor(id) {
  const query = new URLSearchParams();
  query.set('query', `src:med ext_id:${id}`);
  query.set('format', 'json');
  query.set('resultType', 'core');
  const base = settings.europePmcUrl();
  // Java's try covers the request and every read of the answer, so anything
  // Europe PMC sends that Java cannot read is "unable to fetch". Only a name
  // we got wrong is a mistake of ours.
  try {
    const response = await fetch(`${base}?${query.toString()}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return undefined;
    }
    return staticCitationFrom(await response.json());
  } catch (failure) {
    if (failure instanceof ReferenceError) throw failure;
    return undefined;
  }
}

export const citationEndpoints: Endpoint[] = [
  {
    path: '/ContentService/citation/pathway/{id}',
    // CitationController.pathwayCitation: the Pathway Browser's "cite this"
    // -- the pathway's citation and its image's, as a HashMap writes them;
    // {} for an id that is no event.
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const date = queryValues(request, 'dateAccessed');
      if (date.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('dateAccessed'));
      const { citation, failure } = await eventCitationOrFailure(request, raw);
      if (failure) return failure;
      return {
        status: 200,
        type: 'application/json',
        body: citation ? pathwayCitations(citation, date.join(',')) : {},
      };
    },
  },
  {
    path: '/ContentService/citation/static/{id}',
    // CitationController.staticCitation: a paper's citation, by PubMed id,
    // from Europe PMC; Java's 500 text when it cannot be had.
    handler: async (request) => {
      const citation = await staticCitationFor(pathId(rawSegment(request, 4)));
      if (!citation)
        return {
          status: 500,
          type: 'text/plain;charset=UTF-8',
          body: 'Unable to fetch static citation',
        };
      let body;
      try {
        body = formatStaticCitation(citation, 'txt', null);
      } catch (failure) {
        return citationFailure(request, failure);
      }
      return { status: 200, type: 'text/plain;charset=UTF-8', body };
    },
  },
  {
    path: '/ContentService/citation/export',
    // CitationController.export: a citation to download as BibTeX, RIS or
    // text, a pathway's or a paper's. Nothing to cite is an empty 200.
    handler: async (request) => {
      const flag = queryValues(request, 'isPathway');
      if (flag.length === 0)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'isPathway' for method parameter type Boolean is not present"
        );
      const isPathway = springBoolean(flag);
      if (isPathway.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', isPathway.error);
      if (isPathway.value === undefined)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'isPathway' for method parameter type Boolean is present but converted to null"
        );
      const values: { id?: string; ext?: string; dateAccessed?: string } = {};
      for (const name of ['id', 'ext', 'dateAccessed'] as const) {
        const given = queryValues(request, name);
        if (given.length === 0) return javaError(request, 400, 'BAD_REQUEST', requiredString(name));
        values[name] = given.join(',');
      }
      let citation;
      if (isPathway.value) {
        // Set above, or the 400 was answered.
        const found = await eventCitationOrFailure(request, values.id as string);
        if (found.failure) return found.failure;
        citation = found.citation;
      } else citation = await staticCitationFor(values.id);
      if (!citation) return { status: 200 };
      const format = isPathway.value ? formatEventCitation : formatStaticCitation;
      let body;
      try {
        body = format(citation, values.ext, values.dateAccessed);
      } catch (failure) {
        return citationFailure(request, failure);
      }
      const [extension, type] =
        values.ext === 'bib'
          ? ['bib', 'application/x-bibtex']
          : values.ext === 'ris'
            ? ['ris', 'application/x-research-info-systems']
            : ['txt', 'text/plain'];
      return {
        status: 200,
        type: `${type};charset=UTF-8`,
        headers: {
          'Content-Disposition': tomcatHeader(
            `attachment; filename="reactome_citation_${values.id}.${extension}"`
          ),
        },
        body,
      };
    },
  },
];
