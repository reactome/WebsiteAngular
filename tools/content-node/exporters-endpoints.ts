/**
 * The exporter endpoints (spec 014, research R1, a family): /exporter/*,
 * diagrams, the species overview and figures drawn by the render service,
 * with the helpers only they use. Moved unchanged from service.ts.
 */
import type { RenderRefusal } from '../../projects/contract/render.ts';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toSbgn, SBGN_MEDIA_TYPE } from 'sbgn-exporter';
import { reactionAnswer } from './reaction-layout/answer.ts';
import type { Answer, Endpoint, Request } from './endpoint.ts';
import { read } from './graph.ts';
import { settings } from './settings.ts';
import {
  deepShare,
  javaError,
  notFound,
  springNotFound,
  unexpected,
  unexpectedFailure,
} from './answers.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  springBoolean,
  springIntegerWithDefault,
} from './spring.ts';
import { present } from './java-text.ts';
import type { Failure } from './answers.ts';
import { graphCoreId, longPastRange, speciesFilter, speciesTaxId } from './objects.ts';
import { diagramResult } from './search-params.ts';

/** The extensions ImageExporterController answers, pdf aside (its own 500). */
const EXPORT_FORMATS = ['png', 'jpg', 'jpeg', 'svg', 'gif'];

/**
 * What diagramImage fails on once the id is resolved, in its order, or
 * undefined: pdf, by its own literal message; a blank quality, unboxed for
 * the raster budget (the service's generic 500, 'unexpected'); a quality
 * outside 1-10, which RasterArgs refuses; a blank ehld, unboxed. Then what
 * this service does not draw: an extension Java has no check for -- its
 * ImageIO writes nothing and it answers an empty 200; this names it -- and
 * gif, whose renderer draws the expression animation, not a still.
 */
export function figureProblem(values: ExportValues, ext: string) {
  const fail = (message: string) => ({ status: 500, reason: 'INTERNAL_SERVER_ERROR', message });
  if (ext === 'pdf') return fail('Unsupported file extension pdf');
  if (values.quality === null) return 'unexpected';
  // Read with its default, so a number here.
  const quality = values.quality as number;
  if (quality < 1 || quality > 10) return fail('quality must be in the range [1-10]');
  if (values.ehld === null) return 'unexpected';
  if (!EXPORT_FORMATS.includes(ext)) return fail(`Unsupported file extension ${ext}`);
  if (ext === 'gif')
    return {
      status: 400,
      reason: 'BAD_REQUEST',
      message:
        'Not drawn by this service yet: gif. The renderer’s GIF is the expression animation, not a still.',
    };
  return undefined;
}

/** Whether a pathway is drawn as its illustration (hasEHLD), as the render page draws it. */
async function hasIllustration(stId: string) {
  const [row] = await read<{ ehld: boolean | null }>(
    'MATCH (p:Pathway{stId:$stId}) RETURN p.hasEHLD AS ehld',
    { stId }
  );
  return row?.ehld === true;
}

/** Where the render service listens: loopback only, never public. */
const RENDER_SERVICE = settings.renderService();

/**
 * Spring's `{identifier}.{ext:.*}`: both variables are `(.*)`, the first
 * greedy, so the extension is what follows the last dot and a versioned id
 * keeps its version (graph-core then cuts it). No dot matches nothing.
 */
export function splitExportName(segment: string) {
  const dot = segment.lastIndexOf('.');
  if (dot === -1) return undefined;
  return { identifier: segment.slice(0, dot), ext: segment.slice(dot + 1) };
}

/** A parameter of the exporters, its kind and default (DIAGRAM_EXPORT). */
type ExportField =
  | [kind: 'integer', name: string, fallback: number | null]
  | [kind: 'boolean', name: string, fallback: boolean]
  | [kind: 'text', name: string, fallback: string | null]
  | [kind: 'list', name: string];

/** The exporters' parameters, converted, by name. */
type ExportValues = {
  sel?: string[];
  token?: string | null;
  quality?: number | null;
  ehld?: boolean | null;
  margin?: number | null;
  [name: string]: unknown;
};

/**
 * diagramImage's parameters, converted in its order as Spring converts them,
 * with their defaults: Integers and Booleans as springIntegerWithDefault and
 * springBoolean read them, `sel` a List<String> -- one value split on commas
 * and trimmed, several taken as they are.
 */
function exporterParameters(
  request: Request,
  fields: ExportField[] = DIAGRAM_EXPORT
): { answer: ReturnType<typeof javaError> } | { values: ExportValues } {
  const values: ExportValues = {};
  const integer = (name: string, fallback: number | null) => {
    const read = springIntegerWithDefault(queryValues(request, name), fallback);
    if (read.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', read.error);
    values[name] = read.value;
    return undefined;
  };
  // Absent or a single empty value is the default; a blank one converts to
  // null, which the controller then passes on as it is.
  const boolean = (name: string, fallback: boolean) => {
    const given = queryValues(request, name);
    if (given.length === 0 || (given.length === 1 && given[0] === '')) {
      values[name] = fallback;
      return undefined;
    }
    const read = springBoolean(given);
    if (read.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', read.error);
    values[name] = read.value ?? null;
    return undefined;
  };
  // A String: repeated values arrive joined by ',', as Spring joins a String[].
  const text = (name: string, fallback: string | null) => {
    const given = queryValues(request, name);
    values[name] =
      given.length > 1
        ? given.join(',')
        : given[0] === undefined || given[0] === ''
          ? fallback
          : given[0];
  };
  const list = (name: string) => {
    const given = queryValues(request, name);
    values[name] = (
      given.length === 1
        ? present(given[0])
            .split(',')
            .map((part) => part.trim())
        : given.filter((value) => value !== '')
    ).filter((value) => value !== '');
    return undefined;
  };
  const read = {
    integer,
    boolean,
    text: (name: string, fallback: string | null) => (text(name, fallback), undefined),
    list,
  };
  for (const [kind, name, fallback] of fields) {
    // Each kind's fallback is its reader's (ExportField); TypeScript cannot
    // follow that through the index.
    const answer = (
      read[kind] as (name: string, fallback: unknown) => ReturnType<typeof javaError> | undefined
    )(name, fallback);
    if (answer) return { answer };
  }
  return { values };
}

/** diagramImage's parameters, in its order, with their defaults. */
const DIAGRAM_EXPORT: ExportField[] = [
  ['integer', 'quality', 5],
  ['text', 'flg', null],
  ['boolean', 'flgInteractors', true],
  ['list', 'sel'],
  ['boolean', 'title', true],
  ['integer', 'margin', 15],
  ['boolean', 'ehld', true],
  ['text', 'diagramProfile', 'Modern'],
  ['text', 'token', null],
  ['text', 'resource', 'TOTAL'],
  ['text', 'analysisProfile', 'Standard'],
  ['integer', 'expColumn', null],
];

/**
 * fireworksImage's parameters, in its order, with their defaults. Its
 * profile has no default in Java's description: any one given is refused.
 */
const OVERVIEW_EXPORT: ExportField[] = [
  ['integer', 'quality', 5],
  ['text', 'flg', null],
  ['boolean', 'flgInteractors', true],
  ['list', 'sel'],
  ['boolean', 'title', true],
  ['integer', 'margin', 15],
  ['text', 'diagramProfile', null],
  ['text', 'token', null],
  ['text', 'resource', 'TOTAL'],
  ['integer', 'expColumn', null],
  ['boolean', 'coverage', false],
];

/**
 * The overview's parameters given at something other than their default that
 * the render service does not draw for it yet, as `name=value`: the species
 * overview draws an analysis (`token`) and nothing else asked of it.
 */
function overviewNotDrawnYet(values: ExportValues) {
  const defaults = {
    flgInteractors: true,
    title: true,
    margin: 15,
    resource: 'TOTAL',
    coverage: false,
  };
  const named = Object.entries(defaults)
    .filter(
      ([name, fallback]) =>
        values[name] !== fallback && !(name === 'margin' && values.margin === null)
    )
    .map(([name]) => `${name}=${String(values[name] ?? '')}`);
  // Read with its default, so a number or null here.
  const quality = values.quality as number | null;
  if (quality !== null && quality !== 5 && quality >= 1 && quality <= 10)
    named.push(`quality=${quality}`);
  for (const name of ['flg', 'diagramProfile', 'expColumn'])
    if (values[name] !== null && values[name] !== undefined)
      named.push(`${name}=${String(values[name])}`);
  const sel = values.sel as string[];
  if (sel.length) named.push(`sel=${sel.join(',')}`);
  return named;
}

/**
 * The render service's request for a species' overview: its genome-wide
 * view, the species by taxId, with an analysis when one is asked for.
 */
function overviewExportRequest(
  taxId: string | number,
  { ext, token }: { ext: string; token?: string | null | undefined }
) {
  const format = ext === 'jpg' ? 'jpeg' : ext;
  const url = new URL(`${RENDER_SERVICE}/render/genome-wide.${format}`);
  url.searchParams.set('species', String(taxId));
  if (token) url.searchParams.set('token', token);
  return url;
}

/**
 * The parameters given at something other than their default that the render
 * service does not draw yet (#273, step 4), as `name=value`.
 */
function notDrawnYet(values: ExportValues) {
  const defaults = {
    quality: 5,
    flgInteractors: true,
    title: true,
    margin: 15,
    ehld: true,
    diagramProfile: 'Modern',
    resource: 'TOTAL',
    analysisProfile: 'Standard',
  };
  // Left for after the resolution, where Java fails on them (figureProblem):
  // a quality outside 1-10, and a blank quality or ehld.
  const quality = values.quality as number | null;
  const later = (name: string) =>
    (name === 'quality' && (quality === null || quality < 1 || quality > 10)) ||
    (name === 'ehld' && values.ehld === null) ||
    // RasterArgs.setMargin(null) keeps its 15: a blank margin is the default.
    (name === 'margin' && values.margin === null);
  const named = Object.entries(defaults)
    .filter(([name, fallback]) => !later(name) && values[name] !== fallback)
    .map(([name]) => `${name}=${String(values[name] ?? '')}`);
  // Opt-in: anything given is something not drawn.
  for (const name of ['flg', 'expColumn'])
    if (values[name] !== null && values[name] !== undefined)
      named.push(`${name}=${String(values[name])}`);
  return named;
}

/**
 * The render service's request for a resolved figure: the diagram that draws
 * it, with Java's selection -- the resolved events, then `sel` -- as
 * `highlight`, which marks them on the whole diagram and frames nothing, as
 * Java draws a selection. jpg is jpeg to the render service.
 */
export function diagramExportRequest(
  result: { diagramStId: string; events?: string[] | null },
  {
    ext,
    sel,
    token,
  }: { ext: string; sel?: string[] | undefined; token?: string | null | undefined }
) {
  const format = ext === 'jpg' ? 'jpeg' : ext;
  const url = new URL(`${RENDER_SERVICE}/render/${result.diagramStId}.${format}`);
  const highlight = [...(result.events ?? []), ...(sel ?? [])];
  if (highlight.length) url.searchParams.set('highlight', highlight.join(','));
  if (token) url.searchParams.set('token', token);
  return url;
}

/** The content type Java sends with each format. */
// UTF-8 on every type, images included: the service forces the encoding.
const FIGURE_TYPE: Record<string, string> = {
  svg: 'image/svg+xml;charset=UTF-8',
  png: 'image/png;charset=UTF-8',
  jpg: 'image/jpg;charset=UTF-8',
  jpeg: 'image/jpeg;charset=UTF-8',
};

/** Why the render service refused or failed a figure (its RenderRefusal), or null. */
function refusalReason(body: unknown): RenderRefusal['error'] | null {
  const field: keyof RenderRefusal = 'error';
  const error: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, field) : undefined;
  return typeof error === 'string' ? error : null;
}

/**
 * Ask the render service for a figure and pass its bytes on. Its 503 -- a
 * full queue -- is passed on with its Retry-After; any other failure is a 500
 * naming it, and a render service that cannot be reached is a 503.
 */
async function renderFigure(request: Request, url: string | URL, ext: string) {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  } catch (caught) {
    const failure = caught as Failure | undefined;
    const late = failure?.name === 'TimeoutError';
    return javaError(
      request,
      503,
      'SERVICE_UNAVAILABLE',
      late ? 'The figure took too long to draw' : 'The figure service cannot be reached'
    );
  }
  if (response.status === 503)
    return {
      ...javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        'Too many figures are being drawn; try again shortly'
      ),
      headers: { 'Retry-After': response.headers.get('retry-after') ?? '5' },
    };
  if (!response.ok) {
    const reason = await response
      .json()
      .then(refusalReason)
      .catch(() => `the figure service answered ${response.status}`);
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', reason);
  }
  return {
    status: 200,
    body: Buffer.from(await response.arrayBuffer()),
    // A format checked before the render was asked for.
    type: FIGURE_TYPE[ext] as string,
  };
}

/** An event an export is asked for: its stable id, and whether it is one an export is made of. */
export interface ExportEvent {
  stId: string | null;
  isEvent: boolean;
}

/**
 * The object an id names, as graph-core's findById reads the id (any version,
 * a dbId, an old REACT_ id), with whether it is a pathway or a reaction: Java
 * answers 400 for anything else. Decided from its labels, where Java loaded
 * every relationship of the object to decide it (about 30 s for ATP).
 */
async function exportEvent(raw: string): Promise<ExportEvent | null> {
  const id = await graphCoreId(raw);
  if (!id) return null;
  const [found] = await read<ExportEvent>(
    `MATCH (n:DatabaseObject ${id.object}) RETURN n.stId AS stId, (n:Pathway OR n:ReactionLikeEvent) AS isEvent LIMIT 1`,
    id.params
  );
  return found ?? null;
}

/**
 * Each export's own share (research R6): Java made one file at a time; past a
 * share, a 503 with Retry-After, as the deep pool answers. Separate from the
 * deep pool, so a burst of exports cannot starve the queries the pages need,
 * and from each other, so one export cannot take the other's places here. The
 * service converts two at once across both (spec 015 T069), for its heap: a
 * BioPAX file may wait there behind two SBML ones, and past the headers' time
 * at the worst (T069 measured 300–310 s): the reader then gets the 503 below,
 * and the service, finishing, keeps the file for the next request.
 */
const SBML_SHARE = deepShare(2);
const BIOPAX_SHARE = deepShare(2);

/**
 * How long the service has to send its headers: under nginx's 300 s, so the
 * reader gets this envelope rather than nginx's page. Once the body flows it
 * is not timed: it is a file the service has already written.
 */
const EXPORT_HEADERS_MS = 290_000;

/** What differs between the library service's exports: the rest is one answer. */
interface ExportFormat {
  /** As the service's path and the messages name it. */
  path: 'sbml' | 'biopax';
  label: 'SBML' | 'BioPAX';
  type: string;
  /** The download's extension. */
  download: string;
  share: ReturnType<typeof deepShare>;
  /** The reader's message for the service's 503: SBML's is a diagram file it could not have. */
  unavailable: string;
}

const SBML: ExportFormat = {
  path: 'sbml',
  label: 'SBML',
  type: 'application/sbml+xml;charset=UTF-8',
  download: 'sbml',
  share: SBML_SHARE,
  unavailable: "The pathway's diagram cannot be had just now; try again shortly",
};

/**
 * BioPAX Level 3 (research R6): `application/rdf+xml`, named `{stId}.biopax`.
 * No URL of Java's, so no download guard to imitate: the name is the server's.
 */
const BIOPAX: ExportFormat = {
  path: 'biopax',
  label: 'BioPAX',
  type: 'application/rdf+xml;charset=UTF-8',
  download: 'biopax',
  share: BIOPAX_SHARE,
  unavailable: 'The BioPAX file cannot be made just now; try again shortly',
};

/**
 * The service's answer, once its headers are in, or a rejection: 'late' when
 * none came in time. Node's own client, not fetch: a fetch body converted to
 * a stream never closes when the connection dies part way -- the failure
 * escapes as an unhandled rejection -- so the share it held was never given
 * back. An IncomingMessage closes either way. Plain HTTP: the service is on
 * loopback.
 */
function exportResponse(url: string, headersMs: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    // A connection per file: a kept-alive one the service has since closed
    // would fail the next file as unreachable.
    const asking = httpGet(url, { agent: false }, (response) => {
      clearTimeout(late);
      resolve(response);
    });
    const late = setTimeout(() => asking.destroy(new Error('late')), headersMs);
    asking.once('error', (failure) => {
      clearTimeout(late);
      reject(failure);
    });
  });
}

/**
 * A body read whole, for an error's reason: empty if it cannot be read, and
 * given up after ten seconds, so an error that never ends holds no share.
 */
function bodyText(response: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    const late = setTimeout(() => response.destroy(), 10_000);
    response.on('data', (part: Buffer) => parts.push(part));
    // A connection that dies part way is a close, with what was read; an
    // error without a listener would end the process.
    response.on('error', () => undefined);
    response.once('end', () => {
      clearTimeout(late);
      resolve(Buffer.concat(parts).toString('utf8'));
    });
    response.once('close', () => {
      clearTimeout(late);
      resolve(Buffer.concat(parts).toString('utf8'));
    });
  });
}

/**
 * An event's SBML, as Java's /exporter/event/{id}.sbml answers it -- its 404,
 * 400, type and download name -- with the body from the library service
 * (deploy/java-library, spec 015 T063), passed on as it arrives. Never made
 * by another implementation: without the service, a 503.
 */
export function sbmlAnswer(
  request: Request,
  ext: 'sbml' | 'xml',
  find: (raw: string) => Promise<ExportEvent | null> = exportEvent,
  headersMs = EXPORT_HEADERS_MS
): Promise<Answer> {
  return exportAnswer(request, ext, SBML, find, headersMs);
}

/**
 * An event's BioPAX Level 3 at /exporter/event/{id}.biopax (spec 015 T070),
 * from the library service (T069), answered as SBML is: the same 404 and 400,
 * R6's type and a `{stId}.biopax` download.
 */
export function biopaxAnswer(
  request: Request,
  find: (raw: string) => Promise<ExportEvent | null> = exportEvent,
  headersMs = EXPORT_HEADERS_MS
): Promise<Answer> {
  return exportAnswer(request, 'biopax', BIOPAX, find, headersMs);
}

/** An event an SBGN file is asked for: as ExportEvent, and whether it is a pathway. */
export interface SbgnEvent extends ExportEvent {
  isPathway: boolean;
}

/** exportEvent, telling a pathway from a reaction: their layouts come from different places. */
async function sbgnEvent(raw: string): Promise<SbgnEvent | null> {
  const id = await graphCoreId(raw);
  if (!id) return null;
  const [found] = await read<SbgnEvent>(
    `MATCH (n:DatabaseObject ${id.object}) RETURN n.stId AS stId, (n:Pathway OR n:ReactionLikeEvent) AS isEvent, (n:Pathway) AS isPathway LIMIT 1`,
    id.params
  );
  return found ?? null;
}

/** Where an SBGN file's layout comes from: injected by the specs. */
export interface SbgnLayouts {
  /** The diagram that holds a pathway: graph-core's DiagramService, as Java asks it. */
  diagramOf: (stId: string) => Promise<string | undefined>;
  /** A diagram file's text, or null when the file is not there; undefined: no folder set. */
  diagramFile: (diagramStId: string) => Promise<string | null | undefined>;
  /** A reaction's layout, as /exporter/reaction/{id}/diagram answers it. */
  reactionLayout: (stId: string) => Promise<unknown>;
}

/**
 * A diagram file's text from DIAGRAM_FILES: null when it is not there,
 * undefined when no folder is set.
 */
export async function readDiagramFile(diagramStId: string): Promise<string | null | undefined> {
  const folder = settings.diagramFiles();
  if (!folder) return undefined;
  // A stable id, from the graph: no path can be built from it but the file's.
  if (!/^R-[A-Z]{3,4}-\d+$/.test(diagramStId)) return null;
  try {
    return await readFile(join(folder, `${diagramStId}.json`), 'utf8');
  } catch (failure) {
    if ((failure as Failure).code === 'ENOENT') return null;
    throw failure;
  }
}

const SBGN_LAYOUTS: SbgnLayouts = {
  diagramOf: async (stId) => (await diagramResult(stId))?.diagramStId,
  diagramFile: readDiagramFile,
  reactionLayout: async (stId) =>
    (JSON.parse((await reactionAnswer(stId)).answer.serialised) as { diagram: unknown }).diagram,
};

/**
 * An event's SBGN-ML, as Java's /exporter/event/{id}.sbgn answers it
 * (SbxxExporterController.eventSBGN; sbgn-exporter spec 001, contracts
 * website-endpoint.md): Java's 404 and 400, then the document sbgn-exporter
 * writes from the event's layout -- a pathway's diagram file (the diagram
 * that holds it), or a reaction's layout from the reaction-layout module --
 * named by the event's stable id. Never another implementation's: no file
 * folder set, a pathway's is a 503.
 *
 * A diagram file missing is Java's 500 for it: ExportManager.getDiagram
 * returns null, SbgnConverter's constructor throws a NullPointerException,
 * and GlobalExceptionHandler answers its own message for one, after the
 * download's name was set (read from Java's code, T018: provoking it live
 * would mail Java's error report). A layout the library refuses is the same
 * unexpected 500: Java's converter would throw.
 */
export async function sbgnAnswer(
  request: Request,
  find: (raw: string) => Promise<SbgnEvent | null> = sbgnEvent,
  layouts: SbgnLayouts = SBGN_LAYOUTS
): Promise<Answer> {
  const name = splitExportName(pathId(rawSegment(request, 4)));
  if (name?.ext !== 'sbgn') return springNotFound(request);
  const refused = longPastRange([name.identifier]);
  if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
  const event = await find(name.identifier);
  if (!event) return notFound(request, `Identifier '${name.identifier}' not found`);
  if (!event.isEvent || !event.stId)
    return javaError(
      request,
      400,
      'BAD_REQUEST',
      `The identifier '${name.identifier}' does not correspond to a pathway or reaction`
    );
  const download = { 'Content-Disposition': `attachment; filename="${event.stId}.sbgn"` };
  const failed = (): Answer => ({ ...unexpectedFailure(request), headers: download });
  let layout: unknown;
  if (event.isPathway) {
    const diagramStId = await layouts.diagramOf(event.stId);
    const text = diagramStId === undefined ? null : await layouts.diagramFile(diagramStId);
    if (text === undefined)
      return javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The diagram files are not configured');
    if (text === null) {
      console.error(`SBGN for ${event.stId}: no diagram file for ${diagramStId ?? 'it'}`);
      return failed();
    }
    layout = JSON.parse(text);
  } else {
    // The reaction layout's answer is written as Java's NON_EMPTY mapper
    // writes it, an empty list left out; Java's converter read the object,
    // where an empty list is a list (a reaction drawn in no compartment).
    layout = {
      compartments: [],
      nodes: [],
      edges: [],
      ...((await layouts.reactionLayout(event.stId)) as object),
    };
  }
  try {
    return {
      status: 200,
      // Java's type, as written: a Buffer body is sent as it is, a string's
      // charset Express would rewrite.
      type: SBGN_MEDIA_TYPE,
      body: Buffer.from(toSbgn(layout as Parameters<typeof toSbgn>[0]), 'utf8'),
      headers: download,
    };
  } catch (failure) {
    console.error(`SBGN for ${event.stId}: ${(failure as Error).message}`);
    return failed();
  }
}

/**
 * /exporter/event/{id}: BioPAX for `.biopax`, SBGN for `.sbgn`, SBML for the
 * rest (any other extension Spring's 404). An event's PDF is at another
 * address, /exporter/document/event/{id}.pdf (eventPdfAnswer).
 */
export function eventExportAnswer(
  request: Request,
  find: (raw: string) => Promise<ExportEvent | null> = exportEvent,
  headersMs = EXPORT_HEADERS_MS,
  sbgn: (request: Request) => Promise<Answer> = sbgnAnswer
): Promise<Answer> {
  const ext = splitExportName(pathId(rawSegment(request, 4)))?.ext;
  if (ext === 'sbgn') return sbgn(request);
  return ext === 'biopax'
    ? biopaxAnswer(request, find, headersMs)
    : sbmlAnswer(request, 'sbml', find, headersMs);
}

/**
 * The library service's file for an event, answered as Java's SBML export is.
 * The service's reasons name its own paths, so they are logged here and never
 * passed on.
 */
async function exportAnswer(
  request: Request,
  ext: string,
  format: ExportFormat,
  find: (raw: string) => Promise<ExportEvent | null>,
  headersMs: number
): Promise<Answer> {
  const name = splitExportName(pathId(rawSegment(request, 4)));
  // Another extension on /exporter/event/ is Spring's 404, as Java answers
  // it; SBGN is answered before this (sbgnAnswer).
  if (name?.ext !== ext) return springNotFound(request);
  const refused = longPastRange([name.identifier]);
  if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
  const event = await find(name.identifier);
  if (!event) return notFound(request, `Identifier '${name.identifier}' not found`);
  if (!event.isEvent || !event.stId)
    return javaError(
      request,
      400,
      'BAD_REQUEST',
      `The identifier '${name.identifier}' does not correspond to a pathway or reaction`
    );
  // The library service's address: SBML_SERVICE names it, for both its exports.
  const service = settings.sbmlService();
  if (!service)
    return javaError(
      request,
      503,
      'SERVICE_UNAVAILABLE',
      `The ${format.label} service is not configured`
    );
  if (!format.share.enter())
    return {
      ...javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        `Too many ${format.label} files are being made; try again shortly`
      ),
      headers: { 'Retry-After': '5' },
    };
  // Held until the body has been passed on, or until no body will be.
  let streaming = false;
  try {
    let response: IncomingMessage;
    try {
      response = await exportResponse(
        `${service.replace(/\/$/, '')}/${format.path}/${event.stId}`,
        headersMs
      );
    } catch (caught) {
      return javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        (caught as Failure).message === 'late'
          ? `The ${format.label} file took too long to make`
          : `The ${format.label} service cannot be reached`
      );
    }
    const status = response.statusCode ?? 0;
    if (status !== 200) {
      const reason = await bodyText(response);
      console.error(`${format.label} for ${event.stId}: the service answered ${status} ${reason}`);
      // The event was found above, so a 404 here is the service out of step --
      // an older image without the route, or another release's graph -- not
      // an answer about the id: unavailable for now, as a 503 is.
      return status === 503 || status === 404
        ? {
            ...javaError(request, 503, 'SERVICE_UNAVAILABLE', format.unavailable),
            headers: { 'Retry-After': '30' },
          }
        : javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            `The ${format.label} of ${event.stId} cannot be made`
          );
    }
    response.once('close', () => format.share.leave());
    streaming = true;
    return {
      status: 200,
      type: format.type,
      body: response,
      headers: {
        'Content-Disposition': `attachment; filename="${event.stId}.${format.download}"`,
      },
    };
  } finally {
    if (!streaming) format.share.leave();
  }
}

/**
 * The PDF's own share: two at once, as the PDF service makes two at once
 * (deploy/pdf-export, its --concurrency). Java made four at once and queued
 * the rest without limit; past this share, a 503 with Retry-After, as SBML's.
 */
const PDF_SHARE = deepShare(2);

/**
 * How long the PDF service has to send its headers: past its own deadline for
 * a PDF (120 s, pdf-export's LIMITS.deadlineMs), so its own 503 comes first,
 * and under nginx's 300 s. It sends the whole PDF at once, with its length.
 */
const PDF_HEADERS_MS = 130_000;

/** eventPdf's parameters, in Java's order, with its defaults (EventPdfController). */
const PDF_EXPORT: ExportField[] = [
  // Java's name for it, brackets and spaces included: `level` is not read.
  ['integer', 'level [0 - 1]', 1],
  ['text', 'diagramProfile', 'Modern'],
  ['text', 'token', null],
  ['text', 'resource', 'TOTAL'],
  ['boolean', 'importableOnly', false],
  ['integer', 'expColumn', null],
  ['text', 'analysisProfile', 'Standard'],
];

/** The PDF service's reason for a refusal (pdf-export contracts/service.md), or null. */
function pdfRefusal(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const reason: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'reason') : undefined;
  return typeof reason === 'string' ? reason : null;
}

/**
 * An event's PDF, as Java's /exporter/document/event/{id}.pdf answers it
 * (EventPdfController.eventPdf) -- its parameters converted as Spring converts
 * them, its 404 and 400, its type and download name -- with the PDF made by
 * pdf-export's single-event service (deploy/pdf-export; pdf-export spec 001,
 * Story 2, FR-014), passed on as it arrives. Never made by another
 * implementation: without the service, a 503.
 *
 * Where Java answers an empty 200 -- its export failed before writing, and
 * the controller logs and returns -- this answers what failed (the declared
 * differences, Pathway PDFs): an analysis token the AnalysisService does not
 * know (404) or no longer holds (410), and the service unable to make the PDF
 * (503, or 500). A blank level, on which Java fails the same way, is its
 * default. The analysis options the website does not send (the profiles, the
 * resource, the expression column, importable only) are converted as Java
 * converts them, so a value Java refuses is refused, and are otherwise not
 * read (pdf-export spec 001, Assumptions).
 */
export async function eventPdfAnswer(
  request: Request,
  find: (raw: string) => Promise<ExportEvent | null> = exportEvent,
  headersMs = PDF_HEADERS_MS
): Promise<Answer> {
  const name = splitExportName(pathId(rawSegment(request, 5)));
  if (name?.ext !== 'pdf') return springNotFound(request);
  const asked = exporterParameters(request, PDF_EXPORT);
  if ('answer' in asked) return asked.answer;
  const refused = longPastRange([name.identifier]);
  if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
  const event = await find(name.identifier);
  if (!event) return notFound(request, `'${name.identifier}' does not exist`);
  if (!event.isEvent || !event.stId)
    return javaError(request, 400, 'BAD_REQUEST', `'${name.identifier}' is not an event`);
  const service = settings.pdfService();
  if (!service)
    return javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The PDF service is not configured');
  if (!PDF_SHARE.enter())
    return {
      ...javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        'Too many PDFs are being made; try again shortly'
      ),
      headers: { 'Retry-After': '5' },
    };
  // Java's getLevel: below 0 is 0, above 1 is 1.
  const level = asked.values['level [0 - 1]'];
  const depth = typeof level === 'number' && level < 1 ? 0 : 1;
  const token = asked.values['token'];
  const url = new URL(
    `event/${encodeURIComponent(event.stId)}.pdf`,
    service.endsWith('/') ? service : `${service}/`
  );
  url.searchParams.set('depth', String(depth));
  // Once encoded, as the service is to receive it: the token as Spring read it.
  if (typeof token === 'string') url.searchParams.set('token', token);
  // Held until the body has been passed on, or until no body will be.
  let streaming = false;
  try {
    let response: IncomingMessage;
    try {
      response = await exportResponse(url.href, headersMs);
    } catch (caught) {
      return javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        caught instanceof Error && caught.message === 'late'
          ? 'The PDF took too long to make'
          : 'The PDF service cannot be reached'
      );
    }
    const status = response.statusCode ?? 0;
    if (status !== 200) {
      const reason = pdfRefusal(await bodyText(response));
      // Its reasons carry no path, host or name; the token is never logged.
      console.error(`PDF for ${event.stId}: the service answered ${status} ${reason ?? '(none)'}`);
      if (status === 404 && reason === 'unknown-token')
        return javaError(
          request,
          404,
          'NOT_FOUND',
          'No analysis result is known for the token; run the analysis again'
        );
      if (status === 410 && reason === 'gone-token')
        return javaError(
          request,
          410,
          'GONE',
          'The analysis result for the token is no longer held; run the analysis again'
        );
      // The event was found above, so the service's no-event or not-an-event
      // is it out of step -- another release's graph -- not an answer about
      // the id: unavailable for now, as its own 503 is.
      return status === 503 || reason === 'no-event' || reason === 'not-an-event'
        ? {
            ...javaError(
              request,
              503,
              'SERVICE_UNAVAILABLE',
              'The PDF cannot be made just now; try again shortly'
            ),
            headers: { 'Retry-After': '30' },
          }
        : javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            `The PDF of ${event.stId} cannot be made`
          );
    }
    response.once('close', () => PDF_SHARE.leave());
    streaming = true;
    return {
      status: 200,
      type: 'application/pdf;charset=UTF-8',
      body: response,
      // Java's header as Java writes it, the extension outside the quotes.
      headers: { 'Content-Disposition': `attachment; filename="${event.stId}".pdf` },
    };
  } finally {
    if (!streaming) PDF_SHARE.leave();
  }
}

export const exportersEndpoints: Endpoint[] = [
  {
    path: '/ContentService/exporter/diagram/{id}',
    // The error path, which is all the diff harness can compare: the figure
    // itself is drawn by another renderer. Never expanded over --ids, which
    // would have Java draw a full figure for every one (a versioned id's
    // version reads as the extension).
    sample: 'XYZ.svg',
    samplesOnly: true,
    differs: [/: \.url: /],
    /**
     * A diagram figure, as ImageExporterController.diagramImage answers it:
     * graph-core's DiagramService resolves the id to the diagram that draws
     * it and the events to select there, and the drawing is the render
     * service's (tools/render) -- the site's own renderer -- asked over
     * loopback, the whole diagram with those events highlighted.
     *
     * Not routed yet (#273). Every parameter Java takes is converted as Spring
     * converts it; any this does not draw yet is refused by name at a value
     * other than its default, because a figure that leaves out what was asked
     * for is a 200 no caller can detect.
     */
    handler: async (request) => {
      const name = splitExportName(pathId(rawSegment(request, 4)));
      if (!name) return springNotFound(request);
      const asked = exporterParameters(request);
      if ('answer' in asked) return asked.answer;
      const unsupported = notDrawnYet(asked.values);
      if (unsupported.length)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          `Not drawn by this service yet: ${unsupported.join(', ')}. Ask without them, or at their defaults.`
        );

      const refused = longPastRange([name.identifier]);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      const result = await diagramResult(name.identifier);
      if (!result)
        return javaError(request, 400, 'BAD_REQUEST', `'${name.identifier}' is not an event`);
      const ext = name.ext.toLowerCase();
      const problem = figureProblem(asked.values, ext);
      if (problem === 'unexpected') return unexpected(request);
      if (problem) return javaError(request, problem.status, problem.reason, problem.message);
      const figure = diagramExportRequest(result, { ...asked.values, ext });
      // Java selects on an illustration too; the render page does not yet.
      if (figure.searchParams.has('highlight') && (await hasIllustration(result.diagramStId)))
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          `Not drawn by this service yet: a selection on ${result.diagramStId}'s illustration. Ask with ehld=false once that is drawn, or for the pathway itself.`
        );
      return renderFigure(request, figure, ext);
    },
  },
  {
    path: '/ContentService/exporter/event/{id}',
    // The error path: the body is compared by sbml-exporter's ci/compare.py
    // (spec 015 T067), not by the harness. A small object that is no event:
    // Java loads every relationship to decide it, which is slow for a large one.
    sample: '9626065.sbml',
    samplesOnly: true,
    /**
     * An event's SBML (spec 015 T065) or BioPAX Level 3 (T070), from the
     * library service. SBML is routed on beta (dev.conf, T066), locally and
     * under ng serve; the release and production keep Java's until T068.
     * BioPAX is routed by T071, and Java has no BioPAX here.
     */
    handler: (request) => eventExportAnswer(request),
  },
  {
    path: '/ContentService/exporter/document/event/{id}',
    // The error path: the PDF itself is pdf-export's, compared by meaning in
    // its own repository. A small object that is no event, as SBML's.
    sample: '9626065.pdf',
    samplesOnly: true,
    /**
     * An event's PDF (spec 006 T100), from pdf-export's single-event service.
     * Routed on beta alone (dev.conf), locally and under ng serve; the release
     * and production keep Java's until they run the service.
     */
    handler: (request) => eventPdfAnswer(request),
  },
  {
    path: '/ContentService/exporter/sbml/{id}',
    sample: '9626065.xml',
    samplesOnly: true,
    /** The same file at the URL the site's download page used (research R6). */
    handler: (request) => sbmlAnswer(request, 'xml'),
  },
  {
    path: '/ContentService/exporter/voronoi/{id}',
    // No sample, and none from --ids: Java has no such URL, so the parity
    // harness has nothing to compare it with. overview-export.spec.ts holds it.
    samplesOnly: true,
    /**
     * A species' overview, the Voronoi map the site shows (Reacfoam), drawn
     * by the render service's genome-wide view -- at a URL named for it
     * (spec 006 T093, decided 22 Oct 2026). The old fireworks exporter's URL
     * redirects here; Fireworks itself is retired. The species is read as
     * Java's exporter read it: a taxId, a dbId, or a name in any case with
     * '_' for a space ('Homo_sapiens', 'homo_sapiens' and 9606 are all human).
     *
     * Every parameter the old exporter took is converted as Spring converts
     * it, and one this does not draw is refused by name at a value other than
     * its default: an overview that leaves out a flag or a profile asked for
     * is a 200 no caller can detect.
     */
    handler: async (request) => {
      const name = splitExportName(pathId(rawSegment(request, 4)));
      if (!name) return springNotFound(request);
      const asked = exporterParameters(request, OVERVIEW_EXPORT);
      if ('answer' in asked) return asked.answer;
      const unsupported = overviewNotDrawnYet(asked.values);
      if (unsupported.length)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          `Not drawn by this service yet: ${unsupported.join(', ')}. Ask without them, or at their defaults.`
        );
      const taxId = await speciesTaxId(speciesFilter(name.identifier));
      if (!taxId)
        return javaError(request, 400, 'BAD_REQUEST', `'${name.identifier}' is not a species`);
      const ext = name.ext.toLowerCase();
      const problem = figureProblem(asked.values, ext);
      if (problem === 'unexpected') return unexpected(request);
      if (problem) return javaError(request, problem.status, problem.reason, problem.message);
      return renderFigure(
        request,
        overviewExportRequest(taxId, { ext, token: asked.values.token }),
        ext
      );
    },
  },
  {
    path: '/ContentService/exporter/fireworks/{id}',
    // No sample, and none from --ids: Java draws here, node redirects.
    samplesOnly: true,
    /**
     * The old fireworks exporter's URL, a 301 to the Voronoi overview with the
     * same species, extension and query (decided 22 Oct 2026): Fireworks is
     * retired, and a caller of the old URL gets the overview the site shows.
     */
    // Built from its parts, not by rewriting the URL as sent: routing
    // decodes `fire%77orks` to fireworks, which a text replace would miss
    // and redirect to itself.
    handler: async (request) => {
      const url = String(request.originalUrl);
      const at = url.indexOf('?');
      return {
        status: 301,
        headers: {
          Location: `/ContentService/exporter/voronoi/${rawSegment(request, 4)}${at === -1 ? '' : url.slice(at)}`,
        },
      };
    },
  },
];
