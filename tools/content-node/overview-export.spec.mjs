// @vitest-environment node
//
// /exporter/voronoi/{species}.{ext}: a species' overview, the Voronoi map the
// site shows (Reacfoam), the render service's genome-wide view (spec 006
// T093); the old /exporter/fireworks/ URL redirects to it. A stand-in graph
// answers the species lookup, and a stand-in render service records what it
// is asked for. Java's answers measured on production, 19 Oct 2026.
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SPECIES = { 9606: '9606', 'Homo sapiens': '9606', 48887: '9606', 'Mus musculus': '10090' };
vi.mock('./graph.ts', () => ({
  read: async (cypher, params) => {
    const taxId = SPECIES[params?.value];
    if (cypher.includes('{taxId: $value}'))
      return taxId && params.value === taxId ? [{ taxId }] : [];
    if (cypher.includes('{dbId: toInteger($value)}'))
      return params.value === '48887' ? [{ taxId: '9606' }] : [];
    if (cypher.includes('$value IN s.name')) return taxId ? [{ taxId }] : [];
    return [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const asked = [];
let renderer;
let base;
let server;
beforeAll(async () => {
  renderer = createServer((request, response) => {
    asked.push(request.url);
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end('<svg/>');
  });
  await new Promise((resolve) => renderer.listen(0, '127.0.0.1', resolve));
  process.env.RENDER_SERVICE_URL = `http://127.0.0.1:${renderer.address().port}`;
  const { app } = await import('./server.ts');
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => renderer.close(resolve));
});

const at = (path) => fetch(`${base}/ContentService/exporter/voronoi/${path}`);
const envelope = async (response) => {
  const body = await response.json();
  return [response.status, body.reason, body.messages];
};

describe('the species overview, the Voronoi map', () => {
  it('reads the species as Java does, and asks for that species’ genome-wide view', async () => {
    asked.length = 0;
    for (const species of ['Homo_sapiens', 'homo_sapiens', '9606', '48887', 'Homo%20sapiens'])
      expect([species, (await at(`${species}.svg`)).status]).toEqual([species, 200]);
    expect(new Set(asked)).toEqual(new Set(['/render/genome-wide.svg?species=9606']));
    const mouse = await at('Mus_musculus.png');
    expect([mouse.status, mouse.headers.get('content-type')]).toEqual([
      200,
      'image/png;charset=UTF-8',
    ]);
    expect(asked.at(-1)).toBe('/render/genome-wide.png?species=10090');
  });

  it('passes an analysis on, and draws jpg as jpeg', async () => {
    await (await at('Mus_musculus.jpg?token=MjAyNjEw')).arrayBuffer();
    expect(asked.at(-1)).toBe('/render/genome-wide.jpeg?species=10090&token=MjAyNjEw');
  });

  it('is Java’s 400 for a species it does not know', async () => {
    expect(await envelope(await at('Nosuchspecies.svg'))).toEqual([
      400,
      'BAD_REQUEST',
      ["'Nosuchspecies' is not a species"],
    ]);
  });

  it('refuses, by name, what the overview does not draw yet, rather than leave it out', async () => {
    const [status, , [message]] = await envelope(
      await at('Homo_sapiens.svg?flg=TP53&coverage=true&sel=R-HSA-1640170&quality=8')
    );
    expect(status).toBe(400);
    for (const name of ['flg=TP53', 'coverage=true', 'sel=R-HSA-1640170', 'quality=8'])
      expect(message).toContain(name);
    expect((await envelope(await at('Homo_sapiens.gif')))[2][0]).toContain('gif');
  });

  it('takes a parameter at its default, which is what every caller gets', async () => {
    const response = await at('Homo_sapiens.svg?quality=5&title=true&margin=15&coverage=false');
    expect(response.status).toBe(200);
  });

  it('names a value Spring cannot read, before anything else', async () => {
    expect((await envelope(await at('Homo_sapiens.svg?coverage=maybe')))[2][0]).toContain(
      'Invalid boolean value [maybe]'
    );
  });

  it('converts the parameters in Java’s order: expColumn before coverage', async () => {
    // Measured on production: the Integer's error, not the Boolean's.
    expect(
      (await envelope(await at('Nosuchspecies.svg?coverage=maybe&expColumn=x')))[2][0]
    ).toContain("to required type 'java.lang.Integer'");
  });

  it('leaves a quality outside 1-10 to Java’s own 500, after the species', async () => {
    expect(await envelope(await at('Nosuchspecies.svg?quality=11'))).toEqual([
      400,
      'BAD_REQUEST',
      ["'Nosuchspecies' is not a species"],
    ]);
    expect(await envelope(await at('Homo_sapiens.svg?quality=11'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['quality must be in the range [1-10]'],
    ]);
  });

  it('takes a blank margin as its default, and refuses a title or a profile', async () => {
    expect((await at('Homo_sapiens.svg?margin=')).status).toBe(200);
    for (const asked of ['title=false', 'diagramProfile=Copper'])
      expect([asked, (await envelope(await at(`Homo_sapiens.svg?${asked}`)))[2][0]]).toEqual([
        asked,
        expect.stringContaining(asked),
      ]);
  });

  it('reads an empty selection as none, and drops empty items from one', async () => {
    expect((await at('Homo_sapiens.svg?sel=,')).status).toBe(200);
    expect((await envelope(await at('Homo_sapiens.svg?sel=a,,b')))[2][0]).toContain('sel=a,b');
  });
});

describe('the old fireworks URL', () => {
  it('redirects to the Voronoi overview, keeping the species, the extension and the query', async () => {
    for (const path of ['9606.svg', 'Homo_sapiens.png?token=ABC&quality=7', 'Nosuchspecies.svg']) {
      const response = await fetch(`${base}/ContentService/exporter/fireworks/${path}`, {
        redirect: 'manual',
      });
      expect([path, response.status, response.headers.get('location')]).toEqual([
        path,
        301,
        `/ContentService/exporter/voronoi/${path}`,
      ]);
    }
  });

  it('redirects an encoded spelling of the old URL too, rather than to itself', async () => {
    // Routing decodes letters; the path's own text still has the escape.
    for (const [path, to] of [
      ['fire%77orks/9606.svg', '9606.svg'],
      [
        'fire%77orks/9606.svg?x=/ContentService/exporter/fireworks/',
        '9606.svg?x=/ContentService/exporter/fireworks/',
      ],
    ]) {
      const response = await fetch(`${base}/ContentService/exporter/${path}`, {
        redirect: 'manual',
      });
      expect([path, response.status, response.headers.get('location')]).toEqual([
        path,
        301,
        `/ContentService/exporter/voronoi/${to}`,
      ]);
    }
  });
});
