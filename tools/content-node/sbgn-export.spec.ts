// @vitest-environment node
//
// /exporter/event/{id}.sbgn (sbgn-exporter spec 001 T018, its
// contracts/website-endpoint.md): Java's 404 and 400, then sbgn-exporter's
// document from the event's layout -- a pathway's diagram file, a reaction's
// layout from the reaction-layout module -- with Java's type, download name
// and errors, measured on a local deployment on 6 and 7 Nov 2026. The graph
// and the files are stand-ins here; the live comparison with Java is recorded
// in spec 006 T100.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { toSbgn } from 'sbgn-exporter';
import {
  eventExportAnswer,
  readDiagramFile,
  sbgnAnswer,
  type SbgnEvent,
  type SbgnLayouts,
} from './exporters-endpoints.ts';
import type { Answer, Request } from './endpoint.ts';

/** A small diagram, as a release's diagram file holds one. */
const DIAGRAM = {
  stableId: 'R-HSA-1',
  compartments: [],
  nodes: [
    {
      id: 2,
      reactomeId: 20,
      displayName: 'A & B',
      renderableClass: 'Protein',
      prop: { x: 10, y: 10, width: 60, height: 20 },
      connectors: [{ edgeId: 1, type: 'INPUT', stoichiometry: { value: 1 } }],
    },
  ],
  edges: [
    {
      id: 1,
      reactomeId: 10,
      displayName: 'a reaction',
      reactionShape: { type: 'BOX', a: { x: 94, y: 14 }, b: { x: 106, y: 26 } },
      segments: [{ from: { x: 70, y: 20 }, to: { x: 94, y: 20 } }],
    },
  ],
};

/** The graph as these cases need it: a pathway, a subpathway, a reaction, a non-event. */
const find = async (raw: string): Promise<SbgnEvent | null> => {
  const id = raw.split('.')[0];
  if (id === 'R-HSA-1' || id === '1') return { stId: 'R-HSA-1', isEvent: true, isPathway: true };
  if (id === 'R-HSA-3') return { stId: 'R-HSA-3', isEvent: true, isPathway: true };
  if (id === 'R-HSA-4') return { stId: 'R-HSA-4', isEvent: true, isPathway: true };
  if (id === 'R-HSA-5') return { stId: 'R-HSA-5', isEvent: true, isPathway: false };
  if (id === 'R-ALL-29358') return { stId: 'R-ALL-29358', isEvent: false, isPathway: false };
  return null;
};

// The folder, and beside it a file a path that left the folder would reach.
const outside = mkdtempSync(join(tmpdir(), 'sbgn-diagrams-'));
const files = join(outside, 'diagram');
mkdirSync(files);
writeFileSync(join(files, 'R-HSA-1.json'), JSON.stringify(DIAGRAM));
writeFileSync(join(outside, 'R-HSA-9.json'), JSON.stringify(DIAGRAM));
afterEach(() => {
  delete process.env['DIAGRAM_FILES'];
});

/** R-HSA-3 is drawn in R-HSA-1's diagram; R-HSA-4's diagram file is missing. */
const layouts = (folder: string | null): SbgnLayouts => ({
  diagramOf: async (stId) => (stId === 'R-HSA-3' ? 'R-HSA-1' : stId),
  diagramFile: async (diagramStId) => {
    if (folder === null) return undefined;
    return diagramStId === 'R-HSA-1' ? JSON.stringify(DIAGRAM) : null;
  },
  reactionLayout: async () => ({ ...DIAGRAM, stableId: 'R-HSA-5' }),
});

const request = (path: string): Request =>
  ({
    originalUrl: `/ContentService/exporter/event/${path}`,
    protocol: 'http',
    get: () => 'localhost',
  }) as unknown as Request;

const answer = (path: string, folder: string | null = files) =>
  sbgnAnswer(request(path), find, layouts(folder));

const envelope = (a: Answer) => {
  const body = JSON.parse(String(a.body)) as { reason: string; messages: string[] };
  return [a.status, body.reason, body.messages];
};

describe('an event’s SBGN', () => {
  it('is sbgn-exporter’s document of its diagram, with Java’s type and download name', async () => {
    const a = await answer('R-HSA-1.sbgn');
    expect(a.status).toBe(200);
    expect(a.type).toBe('application/sbgn+xml;charset=UTF-8');
    expect(a.headers).toEqual({ 'Content-Disposition': 'attachment; filename="R-HSA-1.sbgn"' });
    expect(String(a.body)).toBe(toSbgn(DIAGRAM as unknown as Parameters<typeof toSbgn>[0]));
  });

  it('names the file by the stable id, however the event was asked for', async () => {
    for (const path of ['1.sbgn', 'R-HSA-1.4.sbgn'])
      expect((await answer(path)).headers).toEqual({
        'Content-Disposition': 'attachment; filename="R-HSA-1.sbgn"',
      });
  });

  it('is the diagram that holds a subpathway, named by the subpathway', async () => {
    const a = await answer('R-HSA-3.sbgn');
    expect(a.headers).toEqual({ 'Content-Disposition': 'attachment; filename="R-HSA-3.sbgn"' });
    expect(String(a.body)).toBe(toSbgn(DIAGRAM as unknown as Parameters<typeof toSbgn>[0]));
  });

  it('is a reaction’s layout from the reaction-layout module, with no file needed', async () => {
    const a = await answer('R-HSA-5.sbgn', null);
    expect(a.status).toBe(200);
    expect(a.headers).toEqual({ 'Content-Disposition': 'attachment; filename="R-HSA-5.sbgn"' });
  });

  it('reads a reaction layout whose empty lists were left out, as its answer writes them', async () => {
    const { compartments, ...noCompartments } = { ...DIAGRAM, stableId: 'R-HSA-5' };
    void compartments;
    const a = await sbgnAnswer(request('R-HSA-5.sbgn'), find, {
      ...layouts(null),
      reactionLayout: async () => noCompartments,
    });
    expect(a.status).toBe(200);
    expect(String(a.body)).toBe(
      toSbgn({ ...noCompartments, compartments: [] } as unknown as Parameters<typeof toSbgn>[0])
    );
  });

  it('answers Java’s 400 for an object that is no event, and its 404 for an unknown id', async () => {
    expect(envelope(await answer('R-ALL-29358.sbgn'))).toEqual([
      400,
      'BAD_REQUEST',
      ["The identifier 'R-ALL-29358' does not correspond to a pathway or reaction"],
    ]);
    expect(envelope(await answer('R-HSA-99999999999.sbgn'))).toEqual([
      404,
      'NOT_FOUND',
      ["Identifier 'R-HSA-99999999999' not found"],
    ]);
  });

  it('answers a missing diagram file as Java’s converter does: its 500, the download named', async () => {
    const a = await answer('R-HSA-4.sbgn');
    expect(envelope(a)).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['Something unexpected happened and the error has been reported.'],
    ]);
    expect(a.headers).toEqual({ 'Content-Disposition': 'attachment; filename="R-HSA-4.sbgn"' });
  });

  it('is a 503 for a pathway when no diagram folder is set, never another implementation', async () => {
    expect(envelope(await answer('R-HSA-1.sbgn', null))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The diagram files are not configured'],
    ]);
  });
});

describe('the diagram files, from DIAGRAM_FILES', () => {
  it('are read from the folder: a missing one null, none set undefined', async () => {
    expect(await readDiagramFile('R-HSA-1')).toBe(undefined);
    process.env['DIAGRAM_FILES'] = files;
    expect(JSON.parse(String(await readDiagramFile('R-HSA-1')))).toEqual(DIAGRAM);
    expect(await readDiagramFile('R-HSA-2')).toBe(null);
    // only a stable id names a file: nothing else reaches the folder
    expect(await readDiagramFile('../R-HSA-9')).toBe(null);
    expect(await readDiagramFile('R-HSA-1.json')).toBe(null);
  });
});

describe('the route', () => {
  it('sends .sbgn to the SBGN answer, and the other extensions where they went', async () => {
    const asked: string[] = [];
    const sbgn = async (r: Request): Promise<Answer> => {
      asked.push(String(r.originalUrl));
      return { status: 200 };
    };
    await eventExportAnswer(request('R-HSA-1.sbgn'), async () => null, 1000, sbgn);
    await eventExportAnswer(request('R-HSA-1.sbml'), async () => null, 1000, sbgn);
    await eventExportAnswer(request('R-HSA-1.biopax'), async () => null, 1000, sbgn);
    expect(asked).toEqual(['/ContentService/exporter/event/R-HSA-1.sbgn']);
  });
});

afterAll(() => rmSync(outside, { recursive: true, force: true }));
