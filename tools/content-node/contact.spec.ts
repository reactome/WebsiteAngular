// @vitest-environment node
//
// POST /contact (spec 006 T085, research D23). Nothing here reaches a real
// mail server or Cloudflare: mail goes to an SMTP server in this process,
// with a certificate made for the run, and Turnstile is a server in this
// process too, or a stand-in for its check. A request Java accepts sends
// mail, so Java's answers below are only those it gives before sending,
// measured on 6 Nov 2026 against the deployed service.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './server.ts';
import type { Request } from './endpoint.ts';
import { contactAnswer, TOKEN_PARAMETER } from './contact-endpoints.ts';
import type { ContactDependencies } from './contact-endpoints.ts';
import type { MailSettings, Sender } from './contact.ts';
import { javaBlank, mailSettings, singleAddress, smtpSender, transportOptions } from './contact.ts';
import { turnstileVerified } from './turnstile.ts';

/** A certificate and its key, for names given as a subjectAltName. */
function certificate(dir: string, name: string, altNames: string) {
  const key = path.join(dir, `${name}.key`);
  const cert = path.join(dir, `${name}.crt`);
  execFileSync('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-days',
    '1',
    '-subj',
    `/CN=${name}`,
    '-addext',
    `subjectAltName=${altNames}`,
    '-keyout',
    key,
    '-out',
    cert,
  ]);
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

interface Received {
  from: string;
  to: string[];
  data: string;
}

/**
 * An SMTP server, enough of one for a client to send through: STARTTLS (when
 * offered) with the given certificate, AUTH PLAIN once secure, and every
 * message it is given kept, with the commands that carried it.
 */
function smtpServer(pair: { key: Buffer; cert: Buffer }, offerStartTls = true) {
  const received: Received[] = [];
  const auth: { line: string; secure: boolean }[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    let socket: net.Socket = raw;
    let secure = false;
    let buffer = '';
    let inData = false;
    let current: Received = { from: '', to: [], data: '' };
    const write = (line: string) => socket.write(`${line}\r\n`);
    const handle = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          received.push(current);
          current = { from: '', to: [], data: '' };
          write('250 OK queued');
        } else current.data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      const command = line.toUpperCase();
      if (command.startsWith('EHLO')) {
        const lines = ['stub'];
        if (offerStartTls && !secure) lines.push('STARTTLS');
        if (secure) lines.push('AUTH PLAIN');
        lines.push('8BITMIME');
        socket.write(
          lines.map((each, i) => `250${i === lines.length - 1 ? ' ' : '-'}${each}\r\n`).join('')
        );
      } else if (command.startsWith('HELO')) write('250 stub');
      else if (command === 'STARTTLS' && offerStartTls) {
        write('220 Ready to start TLS');
        raw.removeListener('data', onData);
        const secured = new tls.TLSSocket(raw, { isServer: true, ...pair });
        secured.on('data', onData);
        secured.on('error', () => undefined);
        socket = secured;
        secure = true;
        buffer = '';
      } else if (command.startsWith('AUTH')) {
        auth.push({ line, secure });
        write('235 Authentication successful');
      } else if (command.startsWith('MAIL FROM')) {
        current.from = line;
        write('250 OK');
      } else if (command.startsWith('RCPT TO')) {
        current.to.push(line);
        write('250 OK');
      } else if (command === 'DATA') {
        inData = true;
        write('354 End data with <CR><LF>.<CR><LF>');
      } else if (command === 'QUIT') {
        write('221 Bye');
        socket.end();
      } else if (command === 'RSET' || command === 'NOOP') write('250 OK');
      else write('502 Command not implemented');
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (let at = buffer.indexOf('\r\n'); at !== -1; at = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        handle(line);
      }
    };
    raw.on('data', onData);
    raw.on('error', () => undefined);
    write('220 stub ESMTP');
  });
  return {
    received,
    auth,
    start: () =>
      new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      ),
    stop: () =>
      new Promise<void>((resolve) => {
        for (const each of sockets) each.destroy();
        server.close(() => resolve());
      }),
  };
}

const ENV = [
  'CONTACT_SMTP_HOST',
  'CONTACT_SMTP_PORT',
  'CONTACT_SMTP_AUTH',
  'CONTACT_SMTP_USER',
  'CONTACT_SMTP_PASSWORD',
  'CONTACT_SUPPORT_ADDRESS',
  'CONTACT_SUPPORT_NAME',
  'CLOUDFLARE_SECRET_KEY',
  'TURNSTILE_SECRET',
  'TURNSTILE_VERIFY_URL',
];

/** A deployment that can send: an SMTP server, a support address, a Turnstile secret. */
function configure(port: number, extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    CONTACT_SMTP_HOST: '127.0.0.1',
    CONTACT_SMTP_PORT: String(port),
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

let dir = '';
let good: { key: Buffer; cert: Buffer };
let elsewhere: { key: Buffer; cert: Buffer };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'contact-spec-'));
  good = certificate(dir, 'localhost', 'DNS:localhost,IP:127.0.0.1');
  elsewhere = certificate(dir, 'elsewhere', 'DNS:elsewhere.invalid');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const name of ENV) delete process.env[name];
  vi.restoreAllMocks();
});

/** Dependencies that pass the check and send through the given server, trusting `ca`. */
function trusting(ca: Buffer, verify = vi.fn(async (_token: string) => true)) {
  const sender = vi.fn((mail: MailSettings): Sender => smtpSender(mail, ca));
  return { verify, sender } satisfies ContactDependencies;
}

describe('POST /contact, through the service', () => {
  let base = '';
  let server: ReturnType<ReturnType<typeof app>['listen']>;
  const smtp = smtpServer({ key: Buffer.alloc(0), cert: Buffer.alloc(0) }, false);
  let smtpPort = 0;

  beforeAll(async () => {
    smtpPort = await smtp.start();
    await new Promise<void>((resolve) => {
      server = app().listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await smtp.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => configure(smtpPort));

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
      expect(smtp.received).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => turnstile.close(() => resolve()));
    }
  });

  it('answers 503 in the envelope when the deployment cannot send', async () => {
    delete process.env['CONTACT_SMTP_HOST'];
    const response = await post(form());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      envelope(503, 'SERVICE_UNAVAILABLE', 'Messages cannot be sent from this deployment')
    );
  });
});

describe('the check and the configuration, before anything is sent', () => {
  it('asks Turnstile nothing and sends nothing when a setting is missing', async () => {
    for (const missing of [
      'CONTACT_SMTP_HOST',
      'CONTACT_SUPPORT_ADDRESS',
      'CLOUDFLARE_SECRET_KEY',
    ]) {
      configure(25);
      delete process.env[missing];
      const dependencies = trusting(good.cert);
      const answer = await contactAnswer(request(form()), dependencies);
      expect([missing, answer.status]).toEqual([missing, 503]);
      expect(dependencies.verify).not.toHaveBeenCalled();
      expect(dependencies.sender).not.toHaveBeenCalled();
    }
  });

  it('wants the login when the server asks for one, and a port that is a port', () => {
    configure(587, { CONTACT_SMTP_AUTH: 'true', CONTACT_SMTP_USER: 'user' });
    expect(mailSettings()).toBeUndefined();
    process.env['CONTACT_SMTP_PASSWORD'] = 'password';
    expect(mailSettings()?.auth).toEqual({ user: 'user', pass: 'password' });
    process.env['CONTACT_SMTP_PORT'] = '70000';
    expect(mailSettings()).toBeUndefined();
  });

  it('refuses the token Turnstile refuses, sending nothing', async () => {
    configure(25);
    const dependencies = trusting(
      good.cert,
      vi.fn(async (_token: string) => false)
    );
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
    configure(25);
    const dependencies = trusting(good.cert);
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

describe('the mail, through an SMTP server', () => {
  // Made once the certificates are, in the outer beforeAll.
  let smtp: ReturnType<typeof smtpServer>;
  let port = 0;
  beforeAll(async () => {
    smtp = smtpServer(good);
    port = await smtp.start();
  });
  afterAll(() => smtp.stop());
  beforeEach(() => {
    smtp.received.length = 0;
    smtp.auth.length = 0;
    configure(port);
  });

  /** A message's header block and body, line breaks as sent. */
  const parts = (data: string) => {
    const at = data.indexOf('\r\n\r\n');
    return { headers: data.slice(0, at), body: data.slice(at + 4) };
  };

  it("sends one message to the support address, from it, Reply-To the reader, with Java's body", async () => {
    const answer = await contactAnswer(request(form()), trusting(good.cert));
    expect(answer).toEqual({ status: 200 });
    expect(smtp.received).toHaveLength(1);
    const [mail] = smtp.received;
    expect(mail?.from).toBe('MAIL FROM:<support@example.org>');
    expect(mail?.to).toEqual(['RCPT TO:<support@example.org>']);
    const { headers, body } = parts(mail?.data ?? '');
    expect(headers).toMatch(/^From: Help desk <support@example\.org>$/m);
    expect(headers).toMatch(/^Reply-To: A Reader <reader@example\.org>$/m);
    expect(headers).toMatch(/^To: Help desk <support@example\.org>$/m);
    expect(headers).toMatch(/^Subject: A question$/m);
    expect(headers).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(headers).not.toMatch(/^X-Mailer:/m);
    expect(body).toBe('From: A Reader <reader@example.org>\r\n\r\nHello.\r\nA second line.\r\n');
  });

  it('names the reader by address when no name is given, as Java does', async () => {
    await contactAnswer(request(form({ contactName: ' ' })), trusting(good.cert));
    const { headers, body } = parts(smtp.received[0]?.data ?? '');
    expect(headers).toMatch(/^Reply-To: reader@example\.org$/m);
    expect(body).toBe(
      'From: reader@example.org <reader@example.org>\r\n\r\nHello.\r\nA second line.\r\n'
    );
  });

  it('sends nothing to the reader, whatever sendEmailCopy says', async () => {
    for (const flag of ['on', 'TRUE', 'yes', undefined]) {
      smtp.received.length = 0;
      const answer = await contactAnswer(
        request(form({ sendEmailCopy: flag })),
        trusting(good.cert)
      );
      expect([flag, answer.status, smtp.received.map((each) => each.to)]).toEqual([
        flag,
        200,
        [['RCPT TO:<support@example.org>']],
      ]);
    }
  });

  it('starts no header from a line break in the name or the subject', async () => {
    await contactAnswer(
      request(
        form({
          contactName: 'Name\r\nBcc: victim@example.net',
          subject: 'Subject\r\nBcc: victim@example.net',
        })
      ),
      trusting(good.cert)
    );
    const [mail] = smtp.received;
    expect(mail?.to).toEqual(['RCPT TO:<support@example.org>']);
    const { headers } = parts(mail?.data ?? '');
    expect(headers).not.toMatch(/^Bcc:/im);
    expect(headers.match(/^Reply-To:.*$/gm)).toHaveLength(1);
  });

  it('logs in only once the connection is secure', async () => {
    configure(port, {
      CONTACT_SMTP_AUTH: 'true',
      CONTACT_SMTP_USER: 'u',
      CONTACT_SMTP_PASSWORD: 'p',
    });
    expect((await contactAnswer(request(form()), trusting(good.cert))).status).toBe(200);
    expect(
      smtp.auth.map(({ line, secure }) => [line.split(' ').slice(0, 2).join(' '), secure])
    ).toEqual([['AUTH PLAIN', true]]);
  });
});

describe("the server's certificate", () => {
  const settingsFor = (port: number): MailSettings => ({
    host: '127.0.0.1',
    port,
    supportAddress: 'support@example.org',
    supportName: '',
  });
  const mail = {
    from: 'reader@example.org',
    to: 'support@example.org',
    subject: 's',
    text: 'm',
  };

  it('is checked, by authority and by name, and TLS is required', () => {
    const options = transportOptions(settingsFor(587));
    expect(options.tls?.rejectUnauthorized).toBe(true);
    expect(options.requireTLS).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.tls).not.toHaveProperty('ca');
    expect(transportOptions(settingsFor(465))).toMatchObject({ secure: true });
  });

  it('is refused when no authority the system trusts signed it', async () => {
    const smtp = smtpServer(good);
    const port = await smtp.start();
    try {
      await expect(smtpSender(settingsFor(port)).sendMail(mail)).rejects.toThrow(
        /self-signed certificate/
      );
      expect(smtp.received).toEqual([]);
    } finally {
      await smtp.stop();
    }
  });

  it('is refused when it names another host, even from a trusted authority', async () => {
    const smtp = smtpServer(elsewhere);
    const port = await smtp.start();
    try {
      await expect(smtpSender(settingsFor(port), elsewhere.cert).sendMail(mail)).rejects.toThrow(
        /altnames|hostname|IP/i
      );
      expect(smtp.received).toEqual([]);
    } finally {
      await smtp.stop();
    }
  });

  it('is accepted from the authority given, for the host it names', async () => {
    const smtp = smtpServer(good);
    const port = await smtp.start();
    try {
      await smtpSender(settingsFor(port), good.cert).sendMail(mail);
      expect(smtp.received).toHaveLength(1);
    } finally {
      await smtp.stop();
    }
  });

  it('is never skipped: a server that offers no STARTTLS is not sent the message', async () => {
    const smtp = smtpServer(good, false);
    const port = await smtp.start();
    try {
      await expect(smtpSender(settingsFor(port), good.cert).sendMail(mail)).rejects.toThrow();
      expect(smtp.received).toEqual([]);
    } finally {
      await smtp.stop();
    }
  });

  it("answers 500, without the server's words, when the mail cannot be handed on", async () => {
    const smtp = smtpServer(good);
    const port = await smtp.start();
    configure(port);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The system's authorities, not the test's: the certificate is refused.
      const answer = await contactAnswer(request(form()), {
        verify: async () => true,
        sender: (settings) => smtpSender(settings),
      });
      expect(answer.status).toBe(500);
      expect(String(answer.body)).toContain('"messages":["The message could not be sent"]');
      expect(smtp.received).toEqual([]);
      expect(quiet).toHaveBeenCalledWith(
        expect.stringMatching(/^contact: the message could not be sent \(ESOCKET\)$/)
      );
    } finally {
      await smtp.stop();
    }
  });
});
