// @vitest-environment node
//
// An answer whose body is never read holds its connection until it is
// collected. Solr's refusals (a query it cannot parse) and the report
// service's answers are never read, and either can be asked for by anyone,
// so each is let go at once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendReport } from './report.ts';
import { solr } from './solr.ts';

/** An answer whose body says whether it was let go. */
function answer(status: number) {
  const body = { cancelled: false };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error":{"msg":"cannot parse"}}'));
    },
    cancel() {
      body.cancelled = true;
    },
  });
  return { response: new Response(stream, { status }), body };
}

const saved = { ...process.env };
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

describe('an answer nothing reads', () => {
  it("is let go when Solr refuses the query, and the refusal is still Solr's", async () => {
    process.env['SOLR_URL'] = 'http://127.0.0.1:1/solr/reactome';
    const { response, body } = answer(400);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    await expect(solr('/select', [['q', '(']])).rejects.toMatchObject({
      message: 'Solr answered 400',
      solr: true,
    });
    expect(body.cancelled).toBe(true);
  });

  it("is let go when it is the report service's, whatever its status", async () => {
    process.env['REPORT_URL'] = 'http://127.0.0.1:1';
    for (const status of [200, 500]) {
      const { response, body } = answer(status);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response)
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      sendReport(
        'notfound',
        { agent: null, ip: '203.0.113.1', release: '97' },
        {
          term: 'XYZ',
          resource: '',
        }
      );
      await vi.waitFor(() => expect(body.cancelled).toBe(true));
    }
  });

  it('still says what the report service answered when its body is already broken', async () => {
    process.env['REPORT_URL'] = 'http://127.0.0.1:1';
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('terminated'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(broken, { status: 500 }))
    );
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => logged.push(line));
    sendReport(
      'notfound',
      { agent: null, ip: '203.0.113.1', release: '97' },
      {
        term: 'XYZ',
        resource: '',
      }
    );
    await vi.waitFor(() => expect(logged).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(logged).toEqual(['[REP001] The report service answered 500; no report made']);
  });
});
