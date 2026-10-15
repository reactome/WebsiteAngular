// @vitest-environment node
//
// /exporter/diagram/{identifier}.{ext}, as far as no database or render
// service is needed: how the path splits, how the parameters convert, what is
// refused before anything is resolved, and how a resolution becomes the render
// request. Java's answers measured on 15 Oct 2026.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, diagramExportRequest, splitExportName } from './service.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const at = (path) => fetch(`${base}/ContentService/exporter/diagram/${path}`);
const envelope = async (response) => {
  const body = await response.json();
  return [response.status, body.reason, body.messages];
};

describe('splitExportName, Spring’s {identifier}.{ext:.*}', () => {
  it('takes the extension after the last dot, as the greedy identifier leaves it', () => {
    expect(splitExportName('R-HSA-69620.svg')).toEqual({ identifier: 'R-HSA-69620', ext: 'svg' });
    expect(splitExportName('R-HSA-69620.5.png')).toEqual({
      identifier: 'R-HSA-69620.5',
      ext: 'png',
    });
  });

  it('matches nothing without a dot: Spring’s own 404', () => {
    expect(splitExportName('R-HSA-69620')).toBe(undefined);
  });
});

describe('the parameters, converted before anything is resolved', () => {
  it('names an Integer or a Boolean it cannot read, as Spring does', async () => {
    expect(await envelope(await at('R-HSA-69620.svg?quality=abc'))).toEqual([
      400,
      'BAD_REQUEST',
      [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; nested exception is java.lang.NumberFormatException: For input string: \"abc\"",
      ],
    ]);
    expect(await envelope(await at('R-HSA-69620.svg?title=maybe'))).toEqual([
      400,
      'BAD_REQUEST',
      [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; nested exception is java.lang.IllegalArgumentException: Invalid boolean value [maybe]",
      ],
    ]);
  });

  it('answers an id that is no event with Java’s 400', async () => {
    expect(await envelope(await at('XYZ.svg'))).toEqual([
      400,
      'BAD_REQUEST',
      ["'XYZ' is not an event"],
    ]);
  });

  it('refuses, by name, a parameter it does not draw yet, rather than ignore it', async () => {
    // #273: a figure that silently leaves out what was asked for is a 200 no
    // caller can detect.
    const [status, , [message]] = await envelope(await at('R-HSA-69620.svg?quality=10&flg=TP53'));
    expect(status).toBe(400);
    expect(message).toContain('quality=10');
    expect(message).toContain('flg=TP53');
  });

  it('takes a parameter at its default, which is what every caller gets', async () => {
    const response = await at('XYZ.svg?quality=5&title=true&margin=15&diagramProfile=Modern');
    // Past the parameters to the resolution, which this id fails.
    expect((await envelope(response))[2]).toEqual(["'XYZ' is not an event"]);
  });
});

describe('diagramExportRequest, a resolution as the render request', () => {
  it('draws the diagram that holds the event, the event highlighted, nothing framed', () => {
    const url = diagramExportRequest(
      { diagramStId: 'R-HSA-69620', events: ['R-HSA-69608'] },
      { ext: 'svg', sel: [], token: undefined }
    );
    expect(url.pathname).toBe('/render/R-HSA-69620.svg');
    expect(url.searchParams.get('highlight')).toBe('R-HSA-69608');
    expect(url.searchParams.has('select')).toBe(false);
  });

  it('adds sel to the events, as Java’s toSelect.addAll(sel) does', () => {
    const url = diagramExportRequest(
      { diagramStId: 'R-HSA-69620', events: ['R-HSA-1', 'R-HSA-2'] },
      { ext: 'png', sel: ['R-HSA-3'], token: 'abc%3D' }
    );
    expect(url.searchParams.get('highlight')).toBe('R-HSA-1,R-HSA-2,R-HSA-3');
    expect(url.searchParams.get('token')).toBe('abc%3D');
  });

  it('highlights nothing for a pathway drawn as itself', () => {
    const url = diagramExportRequest(
      { diagramStId: 'R-HSA-69620', events: [] },
      { ext: 'jpg', sel: [], token: undefined }
    );
    expect(url.searchParams.has('highlight')).toBe(false);
    expect(url.pathname).toBe('/render/R-HSA-69620.jpeg');
  });
});
