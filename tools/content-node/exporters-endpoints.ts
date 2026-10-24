/**
 * The exporter endpoints (spec 014, research R1, a family): /exporter/*,
 * diagrams, the species overview and figures drawn by the render service,
 * with the helpers only they use. Moved unchanged from service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import { read } from './graph.ts';
import { settings } from './settings.ts';
import { javaError, springNotFound, unexpected } from './answers.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  springBoolean,
  springIntegerWithDefault,
} from './spring.ts';
import { present } from './java-text.ts';
import type { Failure } from './answers.ts';
import { longPastRange, speciesFilter, speciesTaxId } from './objects.ts';
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
      .then((body: { error?: string }) => body.error ?? null)
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
