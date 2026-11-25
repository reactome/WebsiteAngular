// The analysis report followed on the page (spec 031 T008, T012, T014): the states in order,
// each failure, the silence, cancel and download again, against a stub of the report's
// address.
import { describe, expect, it } from 'vitest';
import type {
  AnalysisReportAccepted,
  AnalysisReportStatus,
} from '../../../../contract/analysis-report.ts';
import { KEEP_MS, ReportDownload, SILENCE_MS, statusOf, type ReportPort } from './report-download';

const ADDRESS = '/AnalysisService/report/TOKEN/9606/report.pdf';

const accepted = (status?: AnalysisReportStatus): Response => {
  // the 202 as the contract has pdf-export write it
  const body: AnalysisReportAccepted = {
    code: 202,
    reason: 'Accepted',
    messages: [],
    ...(status ? { status } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};
const pdf = (): Response =>
  new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="report.pdf"' },
  });
const refused = (status: number, headers: Record<string, string> = {}): Response =>
  new Response('{}', { status, headers });

/** A stub page: answers from a list, a clock moved by hand, every request and save kept. */
function stub(answers: (Response | Error)[]) {
  const asked: RequestInit[] = [];
  const addresses: string[] = [];
  const saved: string[] = [];
  const clock = { now: 0 };
  let left = [...answers];
  /** A request made with no answer left: answered by the next one added. */
  let held: ((answer: Response | Error) => void) | null = null;
  const settleWith = (next: Response | Error): Promise<Response> =>
    next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  const port: ReportPort = {
    fetch: (address, init) => {
      addresses.push(address);
      asked.push(init);
      const next = left.shift();
      if (next !== undefined) return settleWith(next);
      return new Promise<Response>((resolve, reject) => {
        held = (answer) => {
          held = null;
          if (answer instanceof Error) reject(answer);
          else resolve(answer);
        };
      });
    },
    save: (_file, name) => saved.push(name),
    now: () => clock.now,
    pause: (ms) => {
      clock.now += ms;
      return Promise.resolve();
    },
  };
  return {
    port,
    asked,
    addresses,
    saved,
    clock,
    answer: (more: (Response | Error)[]) => {
      left = [...left, ...more];
      const first = left.shift();
      if (first === undefined) return;
      if (held) held(first);
      else left.unshift(first);
    },
  };
}

/** Lets the report's requests and their answers run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('a report followed on the page', () => {
  it('starts, then is queued, then made, then saved once, under its name', async () => {
    const page = stub([
      accepted({ state: 'queued', place: 2 }),
      accepted({ state: 'making', stage: 'figures', done: 3, total: 10, estimate: 40 }),
      pdf(),
    ]);
    const report = new ReportDownload(ADDRESS, 'fallback.pdf', page.port);
    const seen: string[] = [];
    report.ask();
    seen.push(report.phase().status);
    await settle();
    expect(seen).toEqual(['starting']);
    expect(report.phase()).toEqual({ status: 'saved' });
    expect(page.saved).toEqual(['report.pdf']);
    // asked again after each 202, for JSON as well as the PDF, held at most 5 s
    expect(page.asked).toHaveLength(3);
    for (const init of page.asked) {
      expect(init.headers).toEqual({
        Accept: 'application/pdf, application/json',
        Prefer: 'wait=5',
      });
    }
  });

  it('shows each 202 as it comes', async () => {
    const page = stub([accepted({ state: 'queued', place: 2 })]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'waiting', report: { state: 'queued', place: 2 } });
    page.answer([accepted({ state: 'making', stage: 'printing' })]);
    await settle();
    expect(report.phase()).toEqual({
      status: 'waiting',
      report: { state: 'making', stage: 'printing' },
    });
  });

  it('reads a 202 without a status, from a service before it, as being made', async () => {
    const page = stub([accepted()]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'waiting', report: { state: 'making' } });
  });

  it('asking again while it is followed follows the same report', async () => {
    const page = stub([accepted({ state: 'making', stage: 'reading' })]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    report.ask();
    await settle();
    expect(page.asked).toHaveLength(2);
  });
});

describe('its failures (T012)', () => {
  it('a result gone or unknown: gone, from a 410 or a 404', async () => {
    for (const status of [410, 404]) {
      const report = new ReportDownload(ADDRESS, 'r.pdf', stub([refused(status)]).port);
      report.ask();
      await settle();
      expect(report.phase(), String(status)).toEqual({ status: 'failed', failure: 'gone' });
    }
  });

  it('the service busy, with when to try again', async () => {
    const report = new ReportDownload(
      ADDRESS,
      'r.pdf',
      stub([refused(503, { 'Retry-After': '10' })]).port
    );
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'failed', failure: 'busy', retryAfter: 10 });
  });

  it('the report failed', async () => {
    const report = new ReportDownload(ADDRESS, 'r.pdf', stub([refused(500)]).port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'failed', failure: 'failed' });
  });

  it('a report cut off as it arrives: failed, not left making it', async () => {
    // The connection dropping while the PDF streamed left the line saying it was
    // being made, the button refusing, with nothing to say why (review of 25 Nov).
    const cut = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('%PDF'));
          controller.error(new Error('connection lost'));
        },
      }),
      { status: 200 }
    );
    const page = stub([cut]);
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'failed', failure: 'failed' });
    expect(page.saved).toEqual([]);
  });

  it('no answer: asked again, and unknown after two minutes', async () => {
    const page = stub(Array.from({ length: 30 }, () => new Error('offline')));
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'failed', failure: 'unreachable' });
    expect(page.clock.now).toBeGreaterThanOrEqual(SILENCE_MS);
    expect(page.asked.length).toBeGreaterThan(1);
  });

  it('trying again after a failure asks afresh', async () => {
    const page = stub([refused(500), pdf()]);
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'saved' });
  });
});

describe('cancel and download again (T014)', () => {
  it('cancel stops asking; nothing is saved', async () => {
    const page = stub([accepted({ state: 'making', stage: 'reading' })]);
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    const asked = page.asked.length;
    report.cancel();
    page.answer([pdf(), pdf()]);
    await settle();
    expect(report.phase()).toEqual({ status: 'idle' });
    expect(page.saved).toEqual([]);
    expect(page.asked.length).toBe(asked);
  });

  it('download again within the hour saves the file held, asking nothing', async () => {
    const page = stub([pdf()]);
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    report.again();
    expect(page.saved).toEqual(['report.pdf', 'report.pdf']);
    expect(page.asked).toHaveLength(1);
  });

  it('past the hour, download again asks for the report afresh', async () => {
    const page = stub([pdf(), pdf()]);
    const report = new ReportDownload(ADDRESS, 'r.pdf', page.port);
    report.ask();
    await settle();
    page.clock.now += KEEP_MS;
    report.again();
    await settle();
    expect(page.asked).toHaveLength(2);
    expect(report.phase()).toEqual({ status: 'saved' });
  });
});

describe("a 202's status, read field by field", () => {
  it('keeps what is of its shape and leaves the rest out', () => {
    expect(statusOf({ status: { state: 'queued', place: 3 } })).toEqual({
      state: 'queued',
      place: 3,
    });
    expect(
      statusOf({
        status: { state: 'making', stage: 'drawing', done: -1, total: '9', estimate: 12 },
      })
    ).toEqual({ state: 'making', estimate: 12 });
    expect(statusOf({ status: { state: 'ready' } })).toBeUndefined();
    expect(statusOf({ code: 202 })).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

describe('a report only for a person (User Story 4, T023)', () => {
  const CHECK = { sitekey: '0x4AAA', verify: '/search-answer/verify' };
  /** The gateway's refusal without the site's human pass. */
  const needsCheck = (body: unknown = { code: 401, messages: [], ...CHECK }): Response =>
    new Response(JSON.stringify(body), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  const passed = (): Response => new Response(null, { status: 204 });

  it('shows the check on a 401, and once it passes asks again and saves the report', async () => {
    const page = stub([needsCheck(), passed(), pdf()]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'checking', challenge: CHECK });
    expect(report.busy()).toBe(true);
    expect(await report.solve('solved')).toBe(true);
    await settle();
    expect(report.phase()).toEqual({ status: 'saved' });
    // the token exchanged at the site's route, then the report asked for again
    expect(page.addresses).toEqual([ADDRESS, '/search-answer/verify', ADDRESS]);
    expect(page.asked[1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captchaToken: 'solved' }),
    });
  });

  it('keeps the check when it is refused, so it is shown afresh', async () => {
    const page = stub([needsCheck(), new Response(null, { status: 400 })]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(await report.solve('wrong')).toBe(false);
    expect(report.phase()).toEqual({ status: 'checking', challenge: CHECK });
    expect(page.addresses).toEqual([ADDRESS, '/search-answer/verify']);
  });

  it('fails as not checked when the check cannot be sent', async () => {
    const page = stub([needsCheck(), new Error('offline')]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(await report.solve('solved')).toBe(false);
    expect(report.phase()).toEqual({ status: 'failed', failure: 'not_checked' });
  });

  it('asks nothing when cancelled while checking, and nothing after the check passes', async () => {
    const page = stub([needsCheck(), passed()]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    report.cancel();
    expect(await report.solve('solved')).toBe(false);
    expect(report.phase()).toEqual({ status: 'idle' });
    expect(page.addresses).toEqual([ADDRESS]);
  });

  it('takes a check only at the site itself, and a 401 naming none is a failure', async () => {
    for (const body of [
      { ...CHECK, verify: 'https://elsewhere.example/verify' },
      { ...CHECK, verify: '//elsewhere.example/verify' },
      { ...CHECK, sitekey: '' },
      { code: 401 },
    ]) {
      const page = stub([needsCheck(body)]);
      const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
      report.ask();
      await settle();
      expect([body, report.phase()]).toEqual([body, { status: 'failed', failure: 'failed' }]);
    }
  });

  it("reads the gateway's 503 with no Retry-After as no check on this deployment", async () => {
    const page = stub([refused(503)]);
    const report = new ReportDownload(ADDRESS, 'report.pdf', page.port);
    report.ask();
    await settle();
    expect(report.phase()).toEqual({ status: 'failed', failure: 'no_check' });
  });
});
