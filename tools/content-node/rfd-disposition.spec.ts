// @vitest-environment node
//
// Spring's guard against a reflected download marks a body `inline;filename=f.txt`
// on a path whose extension it doesn't trust -- unless the answer already names its
// own Content-Disposition (AbstractMessageConverterMethodProcessor
// .addContentDispositionHeader returns early when the header is present). Java's
// `.sbgn` answers measured 8 Nov 2026: `attachment; filename="R-HSA-69620.sbgn"`.
import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { writeResult } from './server.ts';
import type { Answer } from './endpoint.ts';

async function disposition(path: string, answer: Answer): Promise<string | null> {
  const front = express()
    .get(path, (_req, res) => writeResult(res, answer))
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => front.once('listening', () => resolve()));
  try {
    const { port } = front.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
    await response.text();
    return response.headers.get('content-disposition');
  } finally {
    front.closeAllConnections();
    front.close();
  }
}

const PATH = '/ContentService/exporter/event/R-HSA-69620.sbgn';

describe("the download guard, as Spring's", () => {
  it("keeps an answer's own Content-Disposition on an untrusted extension", async () => {
    expect(
      await disposition(PATH, {
        status: 200,
        type: 'application/sbgn+xml;charset=UTF-8',
        body: '<sbgn/>',
        headers: { 'Content-Disposition': 'attachment; filename="R-HSA-69620.sbgn"' },
      })
    ).toBe('attachment; filename="R-HSA-69620.sbgn"');
  });

  it('marks a body without one inline f.txt on an untrusted extension', async () => {
    expect(await disposition(PATH, { status: 200, type: 'text/plain', body: 'x' })).toBe(
      'inline;filename=f.txt'
    );
  });
});
