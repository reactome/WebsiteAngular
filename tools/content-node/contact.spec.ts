// @vitest-environment node
//
// POST /contact (spec 006 T085, research D23). Nothing here reaches AWS or
// Cloudflare: SES is a stand-in sender, or the SDK's own client with
// placeholder keys and a request handler that answers in this process, and
// Turnstile is a server in this process, or a stand-in for its check.
// Instance metadata is switched off for the whole file, so a credentials
// lookup could not reach it either. A request Java accepts sends mail, so
// Java's answers below are only those it gives before sending, measured on
// 6 Nov 2026 against the deployed service.
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { SESv2ClientConfig, SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './server.ts';
import type { Endpoint, Request } from './endpoint.ts';
import { endpoints } from './registry.ts';
import { contactAnswer, TOKEN_PARAMETER } from './contact-endpoints.ts';
import type { ContactDependencies } from './contact-endpoints.ts';
import type { MailSettings, Sender } from './contact.ts';
import {
  clientConfig,
  encodedWords,
  javaBlank,
  mailbox,
  oneLine,
  mailSettings,
  sesClient,
  sesSender,
  singleAddress,
} from './contact.ts';
import { turnstileVerified } from './turnstile.ts';

process.env['AWS_EC2_METADATA_DISABLED'] = 'true';

const ENV = [
  'CONTACT_SES_REGION',
  'CONTACT_SUPPORT_ADDRESS',
  'CONTACT_SUPPORT_NAME',
  'CLOUDFLARE_SECRET_KEY',
  'TURNSTILE_SECRET',
  'TURNSTILE_VERIFY_URL',
];

/** A deployment that can send: a support address and a Turnstile secret. */
function configure(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    CONTACT_SUPPORT_ADDRESS: 'support@example.org',
    CONTACT_SUPPORT_NAME: 'Help desk',
    CLOUDFLARE_SECRET_KEY: 'test-secret',
    ...extra,
  });
}

/** A form body, URL-encoded, with every field Java requires unless given otherwise. */
function form(fields: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    contactName: 'A Reader',
    mailAddress: 'reader@example.org',
    subject: 'A question',
    message: 'Hello.\r\nA second line.',
    [TOKEN_PARAMETER]: 'token',
    ...fields,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(all)) if (value !== undefined) params.set(name, value);
  return params.toString();
}

/** The handler's view of a POST of that body. */
function request(
  body: string,
  type = 'application/x-www-form-urlencoded',
  url = '/ContentService/contact'
): Request {
  return {
    originalUrl: url,
    protocol: 'http',
    body: Buffer.from(body),
    get: ((name: string) =>
      ({ 'content-type': type, host: 'localhost' })[name.toLowerCase()]) as NonNullable<
      Request['get']
    >,
  };
}

afterEach(() => {
  for (const name of ENV) delete process.env[name];
  vi.restoreAllMocks();
});

/**
 * Dependencies that pass the check (unless told otherwise) and keep what
 * would be sent, with the settings it was sent under.
 */
function stubbed(verify = vi.fn(async (_token: string) => true), fail?: Error) {
  const sent: { mail: MailSettings; input: SendEmailCommandInput }[] = [];
  const sender = vi.fn((mail: MailSettings): Sender => async (input) => {
    if (fail !== undefined) throw fail;
    sent.push({ mail, input });
    return { MessageId: 'stub' };
  });
  return { verify, sender, sent } satisfies ContactDependencies & { sent: unknown[] };
}

describe('POST /contact, through the service', () => {
  let base = '';
  let server: ReturnType<ReturnType<typeof app>['listen']>;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app().listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // None of these requests passes the check, so the service's own SES
  // sender is never reached; metadata is off besides.
  beforeEach(() => configure());

  const post = (
    body: string,
    type = 'application/x-www-form-urlencoded',
    at = '/ContentService/contact'
  ) => fetch(`${base}${at}`, { method: 'POST', headers: { 'Content-Type': type }, body });

  // Java's own answers, measured; its url is the request's.
  const envelope = (
    code: number,
    reason: string,
    message: string,
    at = '/ContentService/contact'
  ) =>
    `{"code":${code},"reason":"${reason}","url":"${base}${at}","messages":["${message}"],"targets":null}`;

  it("answers a missing parameter as Spring does, naming the first in Java's order", async () => {
    const response = await post('subject=s');
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.text()).toBe(
      envelope(
        400,
        'BAD_REQUEST',
        "Required request parameter 'mailAddress' for method parameter type String is not present"
      )
    );
  });

  it("names Turnstile's field where Java named hCaptcha's", async () => {
    const response = await post(form({ [TOKEN_PARAMETER]: undefined, 'h-captcha-response': 'x' }));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      envelope(
        400,
        'BAD_REQUEST',
        "Required request parameter 'cf-turnstile-response' for method parameter type String is not present"
      )
    );
  });

  it('refuses a blank token as Java does, as text, asking Cloudflare nothing', async () => {
    const asked = vi.spyOn(globalThis, 'fetch');
    const response = await post(
      form({ [TOKEN_PARAMETER]: ' ' }),
      undefined,
      '/ContentService/contact/'
    );
    expect(response.status).toBe(400);
    // Java's text/plain;charset=UTF-8, as Express spells it.
    expect(response.headers.get('content-type')).toMatch(/^text\/plain; ?charset=utf-8$/i);
    expect(await response.text()).toBe('captcha verification failed');
    // The spec's own POST is the only fetch.
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('reads a multipart form, and not a text/plain body, as Java does', async () => {
    const multipart = new FormData();
    for (const [name, value] of new URLSearchParams(form({ [TOKEN_PARAMETER]: '' })))
      multipart.set(name, value);
    const response = await fetch(`${base}/ContentService/contact`, {
      method: 'POST',
      body: multipart,
    });
    expect(await response.text()).toBe('captcha verification failed');

    const plain = await post(form(), 'text/plain');
    expect(await plain.text()).toBe(
      envelope(
        400,
        'BAD_REQUEST',
        "Required request parameter 'mailAddress' for method parameter type String is not present"
      )
    );
  });

  it('answers a 10MB body with the 413 without keeping or parsing it', async () => {
    const started = performance.now();
    // 10MB, below the 10MiB every other POST may send.
    const response = await post(`mailAddress=a%40example.org&${'x'.repeat(10_000_000)}`);
    expect(response.status).toBe(413);
    expect(await response.text()).toBe(
      envelope(413, 'PAYLOAD_TOO_LARGE', 'The message is too large')
    );
    // Reading 10MB on loopback, nothing more.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("stops keeping a body at the endpoint's limit, 64KB for the form", async () => {
    expect(endpoints.find((each) => each.path === '/ContentService/contact')?.bodyLimit).toBe(
      64 * 1024
    );
    // The server's reader, through an endpoint of its own with a small limit:
    // past it the handler sees the mark, and what came past it was dropped.
    const probe: Endpoint = {
      path: '/ContentService/contact-limit-probe',
      method: 'post',
      bodyLimit: 10,
      handler: (request) => ({
        status: 200,
        type: 'application/json',
        body: {
          tooLarge: request.tooLarge === true,
          kept: Buffer.isBuffer(request.body) ? request.body.length : -1,
        },
      }),
    };
    endpoints.push(probe);
    const probing = app().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => probing.once('listening', () => resolve()));
    try {
      const at = `http://127.0.0.1:${(probing.address() as AddressInfo).port}${probe.path}`;
      const read = async (body: string) =>
        (await fetch(at, { method: 'POST', body })).json() as Promise<unknown>;
      expect(await read('0123456789')).toEqual({ tooLarge: false, kept: 10 });
      expect(await read('0123456789a')).toEqual({ tooLarge: true, kept: 0 });
    } finally {
      endpoints.splice(endpoints.indexOf(probe), 1);
      await new Promise<void>((resolve) => probing.close(() => resolve()));
    }
  });

  it("answers another method with Java's 405", async () => {
    const response = await fetch(`${base}/ContentService/contact`);
    expect(response.status).toBe(405);
    expect(await response.text()).toBe(
      envelope(405, 'METHOD_NOT_ALLOWED', "Request method 'GET' not supported")
    );
  });

  it("refuses a token Cloudflare's check does not pass, and sends nothing", async () => {
    const turnstile = createHttpServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }));
    });
    await new Promise<void>((resolve) => turnstile.listen(0, '127.0.0.1', () => resolve()));
    process.env['TURNSTILE_VERIFY_URL'] =
      `http://127.0.0.1:${(turnstile.address() as AddressInfo).port}/`;
    try {
      const response = await post(form());
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('captcha verification failed');
    } finally {
      await new Promise<void>((resolve) => turnstile.close(() => resolve()));
    }
  });

  it('answers 503 in the envelope when the deployment cannot send', async () => {
    delete process.env['CONTACT_SUPPORT_ADDRESS'];
    const response = await post(form());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      envelope(503, 'SERVICE_UNAVAILABLE', 'Messages cannot be sent from this deployment')
    );
  });
});

describe('the check and the configuration, before anything is sent', () => {
  it('asks Turnstile nothing and sends nothing when a setting is missing', async () => {
    for (const missing of ['CONTACT_SUPPORT_ADDRESS', 'CLOUDFLARE_SECRET_KEY']) {
      configure();
      delete process.env[missing];
      const dependencies = stubbed();
      const answer = await contactAnswer(request(form()), dependencies);
      expect([missing, answer.status]).toEqual([missing, 503]);
      expect(dependencies.verify).not.toHaveBeenCalled();
      expect(dependencies.sender).not.toHaveBeenCalled();
    }
  });

  it('sends through the region given, us-east-1 by default, and wants a region that is one', async () => {
    configure();
    expect(mailSettings()).toMatchObject({ region: 'us-east-1' });
    process.env['CONTACT_SES_REGION'] = 'eu-west-2';
    expect(mailSettings()).toEqual({
      supportAddress: 'support@example.org',
      supportName: 'Help desk',
      region: 'eu-west-2',
    });
    expect(clientConfig('eu-west-2').region).toBe('eu-west-2');
    // The client is made, not used: nothing is asked of AWS.
    expect(await sesClient('eu-west-2').config.region()).toBe('eu-west-2');
    process.env['CONTACT_SES_REGION'] = 'eu-west-2.attacker.example';
    expect(mailSettings()).toBeUndefined();
  });

  it('refuses the token Turnstile refuses, sending nothing', async () => {
    configure();
    const dependencies = stubbed(vi.fn(async (_token: string) => false));
    const answer = await contactAnswer(request(form({ [TOKEN_PARAMETER]: 'spent' })), dependencies);
    expect(answer).toEqual({
      status: 400,
      type: 'text/plain;charset=UTF-8',
      body: 'captcha verification failed',
    });
    expect(dependencies.verify).toHaveBeenCalledWith('spent');
    expect(dependencies.sender).not.toHaveBeenCalled();
  });

  it('answers a blank field after the check, as Java does, and an address that is not one', async () => {
    configure();
    const dependencies = stubbed();
    expect((await contactAnswer(request(form({ subject: ' \t' })), dependencies)).body).toBe(
      'missing required field'
    );
    expect(dependencies.verify).toHaveBeenCalledTimes(1);
    for (const address of [
      'a@example.org, b@example.org',
      'Name <a@example.org>',
      'a@b@c',
      'a\u0001@example.org',
      'r\u00e9@example.org',
      'nobody',
    ])
      expect([
        address,
        (await contactAnswer(request(form({ mailAddress: address })), dependencies)).status,
      ]).toEqual([address, 400]);
    expect(dependencies.sender).not.toHaveBeenCalled();
  });

  it('takes one plain address: a dot-atom, no % or !, no =?, a domain of labels', () => {
    for (const address of [
      'reader@example.org',
      'first.last+tag@sub.example.org',
      "o'neil@example.co.uk",
      'a=?b@example.org',
      'x@a-b.example',
    ])
      expect([address, singleAddress(address)]).toEqual([address, true]);
    for (const address of [
      '.a@example.org',
      'a.@example.org',
      'a..b@example.org',
      'a%b@example.org',
      'a!b@example.org',
      '=?utf-8?q?x?=@example.org',
      'a@example',
      'a@-example.org',
      'a@example-.org',
      'a@example..org',
      'a@.example.org',
      'a@example.org.',
      'a@exa_mple.org',
      `${'a'.repeat(65)}@example.org`,
      'a@example.org, b@example.org',
    ])
      expect([address, singleAddress(address)]).toEqual([address, false]);
  });

  it('caps each field, before Turnstile is asked, in the envelope', async () => {
    configure();
    for (const [name, cap] of [
      ['contactName', 200],
      ['subject', 200],
      ['message', 20_000],
    ] as const) {
      const dependencies = stubbed(vi.fn(async (_token: string) => false));
      // Characters, not UTF-16 units: a name of cap emoji is within it. A
      // message of 20,000 is ASCII: past it, 64KB of body comes first.
      const within = await contactAnswer(
        request(form({ [name]: (name === 'message' ? 'x' : '\ud83d\ude00').repeat(cap) })),
        dependencies
      );
      expect([name, within.status]).toEqual([name, 400]);
      expect([name, within.body]).toEqual([name, 'captcha verification failed']);
      const over = await contactAnswer(
        request(form({ [name]: 'x'.repeat(cap + 1) })),
        dependencies
      );
      expect([name, over.status, String(over.body)]).toEqual([
        name,
        400,
        expect.stringContaining(`"messages":["${name} is longer than ${cap} characters"]`),
      ]);
      expect([name, dependencies.verify.mock.calls.length]).toEqual([name, 1]);
    }
  });

  it('refuses a body past 64KB with the 413, and parses 64KB quickly', async () => {
    configure();
    const dependencies = stubbed(vi.fn(async (_token: string) => false));
    const filler = 'message=' + 'a%20b+c%C3%A9'.repeat(5000);
    const big = Buffer.alloc(64 * 1024 + 1, 'a');
    const refused = await contactAnswer({ ...request(''), body: big }, dependencies);
    expect(refused.status).toBe(413);
    // A body of 64KB: parsed whole, every field to hand, well inside 50ms.
    const body = `${form({ message: undefined })}&${filler}`.slice(0, 64 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(64 * 1024);
    const started = performance.now();
    const answer = await contactAnswer(request(body), dependencies);
    expect(performance.now() - started).toBeLessThan(50);
    // Past the message's cap, after parsing: everything was read.
    expect(answer.status).toBe(400);
  });

  it("reads blank as Java's isBlank does", () => {
    expect(javaBlank('')).toBe(true);
    expect(javaBlank(' \t\r\n\u2003\u3000\u001f')).toBe(true);
    // Character.isWhitespace leaves out the no-break spaces.
    expect(javaBlank('\u00a0')).toBe(false);
    expect(javaBlank('\u202f')).toBe(false);
    expect(javaBlank(' x ')).toBe(false);
    expect(singleAddress('reader@example.org')).toBe(true);
  });
});

describe("Turnstile's check", () => {
  let asked: { body: string }[] = [];
  let reply: (res: ServerResponse) => void = () => undefined;
  const turnstile = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      asked.push({ body });
      reply(res);
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => turnstile.listen(0, '127.0.0.1', () => resolve()));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => turnstile.close(() => resolve()));
  });
  beforeEach(() => {
    asked = [];
    process.env['TURNSTILE_VERIFY_URL'] =
      `http://127.0.0.1:${(turnstile.address() as AddressInfo).port}/`;
    process.env['CLOUDFLARE_SECRET_KEY'] = 'test-secret';
  });

  const answering = (status: number, body: string) => {
    reply = (res) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    };
  };

  it('passes only on success: true, sending the secret and the token', async () => {
    answering(200, '{"success":true}');
    expect(await turnstileVerified('the-token')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(asked[0]?.body))).toEqual({
      secret: 'test-secret',
      response: 'the-token',
    });
  });

  it('fails closed on anything else', async () => {
    for (const [status, body] of [
      [200, '{"success":false}'],
      [200, '{"success":"true"}'],
      [200, 'not json'],
      [500, '{"success":true}'],
    ] as const) {
      answering(status, body);
      expect([status, body, await turnstileVerified('t')]).toEqual([status, body, false]);
    }
    process.env['TURNSTILE_VERIFY_URL'] = 'http://127.0.0.1:1/';
    expect(await turnstileVerified('t')).toBe(false);
  });

  it('asks nothing without a secret or a token', async () => {
    answering(200, '{"success":true}');
    expect(await turnstileVerified('')).toBe(false);
    delete process.env['CLOUDFLARE_SECRET_KEY'];
    expect(await turnstileVerified('t')).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe('the message', () => {
  beforeEach(() => configure());

  it("is one, from the support address to it, Reply-To the reader, with Java's body", async () => {
    const dependencies = stubbed();
    expect(await contactAnswer(request(form()), dependencies)).toEqual({ status: 200 });
    expect(dependencies.sent).toEqual([
      {
        mail: {
          supportAddress: 'support@example.org',
          supportName: 'Help desk',
          region: 'us-east-1',
        },
        input: {
          FromEmailAddress: '"Help desk" <support@example.org>',
          Destination: { ToAddresses: ['"Help desk" <support@example.org>'] },
          ReplyToAddresses: ['"A Reader" <reader@example.org>'],
          Content: {
            Simple: {
              Subject: { Data: 'A question', Charset: 'UTF-8' },
              Body: {
                Text: {
                  Data: 'From: A Reader <reader@example.org>\n\nHello.\r\nA second line.',
                  Charset: 'UTF-8',
                },
              },
            },
          },
        },
      },
    ]);
  });

  it('names the reader by address when no name is given, as Java does', async () => {
    const dependencies = stubbed();
    await contactAnswer(request(form({ contactName: ' ' })), dependencies);
    const [sent] = dependencies.sent;
    expect(sent?.input.ReplyToAddresses).toEqual(['reader@example.org']);
    expect(sent?.input.Content?.Simple?.Body?.Text?.Data).toBe(
      'From: reader@example.org <reader@example.org>\n\nHello.\r\nA second line.'
    );
  });

  it('sends nothing to the reader, whatever sendEmailCopy says', async () => {
    for (const flag of ['on', 'TRUE', 'yes', undefined]) {
      const dependencies = stubbed();
      const answer = await contactAnswer(request(form({ sendEmailCopy: flag })), dependencies);
      expect([
        flag,
        answer.status,
        dependencies.sent.map(({ input }) => input.Destination?.ToAddresses),
      ]).toEqual([flag, 200, [['"Help desk" <support@example.org>']]]);
    }
  });

  it('writes a name so that it cannot end its header: one line, quoted or encoded', () => {
    expect(mailbox({ name: 'A "B" \\ C', address: 'a@example.org' })).toBe(
      '"A \\"B\\" \\\\ C" <a@example.org>'
    );
    expect(mailbox({ name: 'Name\r\nBcc: victim@example.net', address: 'a@example.org' })).toBe(
      '"Name  Bcc: victim@example.net" <a@example.org>'
    );
    const encoded = mailbox({ name: 'R\u00e9\u2028Bcc: x', address: 'a@example.org' });
    expect(encoded).toBe(
      `=?UTF-8?B?${Buffer.from('R\u00e9 Bcc: x').toString('base64')}?= <a@example.org>`
    );
    expect(mailbox({ name: ' ', address: 'a@example.org' })).toBe('a@example.org');
    expect(mailbox({ name: '\r\n', address: 'a@example.org' })).toBe('a@example.org');
  });

  it('makes a header one line: control characters and line separators become spaces', () => {
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x2028, 0x2029])
      expect([code, oneLine(`a${String.fromCodePoint(code)}b`)]).toEqual([code, 'a b']);
    expect(oneLine('a\u00a0\u00e9 b')).toBe('a\u00a0\u00e9 b');
  });

  it('splits a long name into encoded words of 75 characters at most, between characters', () => {
    const name = `${'\u00e9'.repeat(30)}\ud83d\ude00${'\u4e2d'.repeat(20)}`;
    const words = encodedWords(name).split(' ');
    expect(words.length).toBeGreaterThan(1);
    let decoded = '';
    for (const word of words) {
      expect([word, word.length <= 75]).toEqual([word, true]);
      const text = Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(word)?.[1] ?? '', 'base64').toString();
      // Whole characters: no word ends or starts inside one.
      expect([word, text.includes('\ufffd')]).toEqual([word, false]);
      decoded += text;
    }
    expect(decoded).toBe(name);
  });

  it("answers SES's failure with the 500, logging its name and status alone", async () => {
    const failure = Object.assign(
      new Error('User arn:aws:sts::000000000000:assumed-role/x is not authorized'),
      {
        name: 'AccessDeniedException',
        $metadata: { httpStatusCode: 403 },
      }
    );
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const answer = await contactAnswer(request(form()), stubbed(undefined, failure));
    expect(answer.status).toBe(500);
    expect(String(answer.body)).toContain('"messages":["The message could not be sent"]');
    expect(quiet.mock.calls).toEqual([
      ['contact: the message could not be sent (AccessDeniedException 403)'],
    ]);
  });
});

describe('through the SDK, answered in this process', () => {
  /** What the SDK would have sent SES: its host and its JSON body. */
  function capturing(region: string) {
    const requests: { hostname: string; path: string; body: Record<string, unknown> }[] = [];
    const handler = {
      handle: async (request: { hostname: string; path: string; body?: unknown }) => {
        requests.push({
          hostname: request.hostname,
          path: request.path,
          body: JSON.parse(String(request.body)) as Record<string, unknown>,
        });
        return {
          response: {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: Readable.from([Buffer.from('{"MessageId":"m"}')]),
          },
        };
      },
    };
    const client = new SESv2Client({
      ...clientConfig(region),
      // Placeholders: the request is signed, never sent.
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'placeholder' },
      requestHandler: handler as unknown as NonNullable<SESv2ClientConfig['requestHandler']>,
    });
    return { client, requests };
  }

  it("goes to the region's SES, with no line break in any header it sets", async () => {
    configure({ CONTACT_SES_REGION: 'eu-west-1' });
    const { client, requests } = capturing('eu-west-1');
    const answer = await contactAnswer(
      request(
        form({
          contactName: 'Name\r\nBcc: victim@example.net',
          subject: 'Subject\r\nBcc: victim@example.net',
        })
      ),
      { verify: async () => true, sender: (mail) => sesSender(mail, client) }
    );
    expect(answer.status).toBe(200);
    expect(requests.map(({ hostname, path }) => [hostname, path])).toEqual([
      ['email.eu-west-1.amazonaws.com', '/v2/email/outbound-emails'],
    ]);
    const body = requests[0]?.body as {
      FromEmailAddress: string;
      ReplyToAddresses: string[];
      Destination: { ToAddresses: string[] };
      Content: { Simple: { Subject: { Data: string } } };
    };
    for (const header of [
      body.FromEmailAddress,
      ...body.ReplyToAddresses,
      ...body.Destination.ToAddresses,
      body.Content.Simple.Subject.Data,
    ])
      expect([header, /[\r\n]/.test(header)]).toEqual([header, false]);
    expect(body.Content.Simple.Subject.Data).toBe('Subject  Bcc: victim@example.net');
  });

  it('is given no agent of its own, so HTTPS is verified by the defaults', () => {
    expect(clientConfig('us-east-1')).toEqual({
      region: 'us-east-1',
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
    });
    const source = readFileSync(new URL('./contact.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/rejectUnauthorized|httpsAgent|NODE_TLS_REJECT_UNAUTHORIZED/);
  });
});
