// @vitest-environment node
//
// /interactors/psicquic/resources -- the Pathway Browser's list of PSICQUIC
// services to draw interactors from -- with a stand-in registry: the
// HUPO-PSI registry client's reading of the XML, interactor-core's sort, and
// content-service's 500 when the list could not be had. Services and URLs
// here are invented.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { registryServices, psicquicResources } from './psicquic.ts';
import { resourcesJson } from './service.mjs';

const service = (name, active, rest = `http://${name}/rest/`, extra = '') =>
  `<service><name>${name}</name><soapUrl>http://${name}/soap</soapUrl><restUrl>${rest}</restUrl>` +
  `<restExample>x</restExample><active>${active}</active><count>1</count>${extra}<tag>MI:1</tag></service>`;
const registry = (...services) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><registry xmlns="http://hupo.psi.org/psicquic/registry">${services.join('')}</registry>`;

describe('the registry', () => {
  it('reads each service as JAXB does: text as it is, entities decoded, active a boolean', () => {
    expect(
      registryServices(
        registry(
          service('A&amp;B', 'true', ' http://padded/'),
          service('C', 'false', '<![CDATA[http://c/?a=1&b=2]]>'),
          service('D', '1')
        )
      )
    ).toEqual([
      { name: 'A&B', soapUrl: 'http://A&B/soap', restUrl: ' http://padded/', active: true },
      { name: 'C', soapUrl: 'http://C/soap', restUrl: 'http://c/?a=1&b=2', active: false },
      { name: 'D', soapUrl: 'http://D/soap', restUrl: 'http://D/rest/', active: true },
    ]);
  });

  it('is a failure when it is not a registry, or not all of one', () => {
    expect(() => registryServices('<html>busy</html>')).toThrow();
    const whole = registry(service('A', 'true'), service('B', 'true'));
    expect(() => registryServices(whole.slice(0, whole.indexOf('<service>', 100)))).toThrow();
  });

  it('reads it as an XML parser does: attributes, empty elements, comments, line ends', () => {
    const xml = registry(
      `<service id="1"><name >A\r\nB</name><soapUrl/><restUrl>r</restUrl><active>true</active></service>`,
      `<!-- <service><name>Gone</name></service> -->`,
      `<service><name><!-- note -->C</name><active> 1 </active></service>`,
      `<service><name/><active>false</active></service>`,
      `<service><name><![CDATA[D\r\nE]]></name></service>`
    );
    expect(registryServices(xml)).toEqual([
      { name: 'A\nB', soapUrl: '', restUrl: 'r', active: true },
      { name: 'C', soapUrl: null, restUrl: null, active: true },
      { name: '', soapUrl: null, restUrl: null, active: false },
      { name: 'D\nE', soapUrl: null, restUrl: null, active: false },
    ]);
    // An empty service, attributes or none, is one with no name -- not the
    // start of the next.
    expect(
      registryServices(registry(`<service a="1"/>`, `<service><name>B</name></service>`)).map(
        (s) => s.name
      )
    ).toEqual([null, 'B']);
  });
});

describe('the resources', () => {
  it("sort by lower-cased name, ties kept in the registry's order, as interactor-core does", () => {
    const sorted = psicquicResources([
      { name: 'bhf-ucl', active: true },
      { name: 'BIND', active: false },
      { name: 'BAR', active: false },
      { name: 'Bar', active: true },
      { name: 'APID', active: false },
    ]);
    expect(sorted.map((r) => `${r.name}:${r.active}`)).toEqual([
      'APID:false',
      'BAR:false',
      'Bar:true',
      'bhf-ucl:true',
      'BIND:false',
    ]);
  });

  it('write as Java does: name, soapURL, restURL, active, an empty one left out', () => {
    expect(
      resourcesJson([
        { name: 'A', soapUrl: 's', restUrl: '', active: false },
        { name: 'B', soapUrl: null, restUrl: 'r', active: true },
      ])
    ).toBe('[{"name":"A","soapURL":"s","active":false},{"name":"B","restURL":"r","active":true}]');
  });
});

describe('/interactors/psicquic/resources', () => {
  let base: string;
  let server: Server;
  let registryServer: Server;
  let answer: string | null = registry(service('Zed', 'true'), service('alpha', 'false'));
  let status = 200;
  let hang = false;
  let asked = 0;
  let askedFor: string | undefined;

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    registryServer = createServer((request, response) => {
      asked += 1;
      askedFor = request.url;
      if (hang) return;
      if (answer === null) {
        response.statusCode = 503;
        response.end('down');
        return;
      }
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/xml');
      response.end(answer);
    });
    await new Promise<void>((resolve) => registryServer.listen(0, '127.0.0.1', resolve));
    // Without its slash, which the registry client adds.
    process.env['PSICQUIC_REGISTRY_URL'] =
      `http://127.0.0.1:${(registryServer.address() as AddressInfo).port}/registry`;
    const { app } = await import('./service.mjs');
    await new Promise<void>((resolve) => {
      server = app().listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env['PSICQUIC_REGISTRY_URL'];
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => registryServer.close(resolve));
  });

  const get = () => fetch(`${base}/ContentService/interactors/psicquic/resources`);

  it("is Java's 500 before the registry has been read", async () => {
    const response = await get();
    expect([response.status, (await response.json()).messages]).toEqual([
      500,
      ["Couldn't load PSICQUIC Resources"],
    ]);
    expect(asked).toBe(0);
  });

  it('answers from the last reading of the registry, and the 500 once a reading fails', async () => {
    const { refreshPsicquicResources } = await import('./service.mjs');
    await refreshPsicquicResources();
    const response = await get();
    expect([response.status, await response.text()]).toEqual([
      200,
      '[{"name":"alpha","soapURL":"http://alpha/soap","restURL":"http://alpha/rest/","active":false},' +
        '{"name":"Zed","soapURL":"http://Zed/soap","restURL":"http://Zed/rest/","active":true}]',
    ]);
    // Asked at the registry's STATUS view, as the HUPO client asks.
    expect([asked, askedFor]).toEqual([1, '/registry/registry?action=STATUS&format=xml']);
    // A registry in trouble, though it sends a list: Java's URL.openStream
    // refuses a status of 400 or more.
    status = 503;
    await refreshPsicquicResources();
    expect((await get()).status).toBe(500);
    status = 200;
    await refreshPsicquicResources();
    expect((await get()).status).toBe(200);
    // A registry that does not answer leaves the list in place, as Java's
    // reading, which has no timeout, does.
    hang = true;
    await refreshPsicquicResources({ timeout: 100 });
    expect((await get()).status).toBe(200);
    hang = false;
    answer = null;
    await refreshPsicquicResources();
    expect((await get()).status).toBe(500);
  });
});
