/**
 * The help-desk message a reader can send from a search that found nothing.
 *
 * Our own route rather than ContentService's /contact, which only accepts an
 * hCaptcha token checked with a secret held there. Here the reader proves they
 * are a person with Cloudflare Turnstile, as for the site's other checks, and
 * the message is handed to the local mail transfer agent.
 *
 *   GET  /contact  -> 200 { sitekey }, or 503 when this deployment cannot send.
 *   POST /contact  { contactName?, mailAddress, subject, message, token }
 *                  -> 200 { sent: true }
 *                     400 a field is missing or malformed
 *                     403 the Turnstile token was refused
 *                     429 too many messages from this address (Retry-After)
 *                     502 the mail could not be handed on
 *                     503 this deployment cannot send
 *
 * Every message is checked: unlike the answer gate there is no switch to turn
 * it off, since an unchecked form that sends mail is a relay for spam.
 *
 * Where mail goes and whom it is from are settings, not code: CONTACT_TO and
 * CONTACT_FROM. Without them, or without Turnstile's keys, the route says it
 * cannot send rather than sending unchecked or nowhere.
 */
const { spawn } = require('node:child_process');
const express = require('express');
const gate = require('./human-gate.js');
const { clientKey, makeLimiter } = require('./search-answer-proxy.js');

// The same rule the form's field uses.
const EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MAX = { contactName: 100, mailAddress: 254, subject: 200, message: 10_000 };

/** Few messages per sender: a reader writes once, a script writes many. */
const contactLimiter = makeLimiter(
  [
    { windowMs: 60_000, max: 3 },
    { windowMs: 3_600_000, max: 10 },
  ],
  { windowMs: 3_600_000, max: 200 }
);

function settings(env = process.env) {
  return {
    to: (env.CONTACT_TO || '').trim(),
    from: (env.CONTACT_FROM || '').trim(),
  };
}

function canSend(env = process.env) {
  const { to, from } = settings(env);
  return Boolean(to && from && gate.TURNSTILE_SITEKEY && gate.TURNSTILE_CONFIGURED);
}

/** A header value with no way to start another header. */
function oneLine(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * RFC 2047, for a subject that is not plain ASCII: encoded words short enough
 * that even the first, after "Subject: ", keeps to 78 characters, folded onto
 * lines of their own, never splitting a character.
 */
function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 42) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
    .join('\n ');
}

const hex = (byte) => `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * Quoted-printable (RFC 2045), so a long paragraph is not broken by the MTA at
 * 998 characters: lines soft-wrapped at 76, anything but printable ASCII
 * escaped.
 */
function quotedPrintable(text) {
  return text
    .split('\n')
    .map((line) => {
      const bytes = [...Buffer.from(line, 'utf8')];
      let encoded = bytes
        .map((byte, index) => {
          const last = index === bytes.length - 1;
          const printable = byte >= 33 && byte <= 126 && byte !== 61;
          // White space is kept, except at a line's end, where transit strips it.
          const space = (byte === 32 || byte === 9) && !last;
          return printable || space ? String.fromCharCode(byte) : hex(byte);
        })
        .join('');
      const out = [];
      while (encoded.length > 76) {
        // Never cut an escape in two.
        let cut = 75;
        const escape = encoded.lastIndexOf('=', cut - 1);
        if (escape > cut - 3) cut = escape;
        out.push(`${encoded.slice(0, cut)}=`);
        encoded = encoded.slice(cut);
      }
      out.push(encoded);
      return out.join('\n');
    })
    .join('\n');
}

/** The whole message, headers and body, as the MTA reads it. */
function compose({ to, from, contactName, mailAddress, subject, message }) {
  return [
    `From: Reactome website <${from}>`,
    `To: ${to}`,
    `Reply-To: ${mailAddress}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(
      [
        message.replace(/\r\n?/g, '\n'),
        '',
        '--',
        `Sent from the website's search page by ${contactName ? `${contactName} <${mailAddress}>` : mailAddress}.`,
      ].join('\n')
    ),
    '',
  ].join('\n');
}

/**
 * Hands a composed message to sendmail. `-t` takes the recipients from the
 * headers, `-i` keeps a line of a lone "." from ending the message early.
 */
function sendmail(raw, from, sendmailPath = '/usr/sbin/sendmail', timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(sendmailPath, ['-t', '-i', '-f', from], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    // A sendmail that never finishes must not hold the request, or the child.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`sendmail did not finish in ${timeoutMs} ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`sendmail exited ${code}: ${stderr.trim()}`));
    });
    // Unheard, a sendmail that exits before reading all of this (EPIPE) would
    // be an uncaught error, and take the whole server down with it.
    child.stdin.on('error', fail);
    child.stdin.end(raw);
  });
}

/** What was sent, checked and trimmed; or the reason it cannot be sent. */
function readMessage(body) {
  const field = (name) => (typeof body?.[name] === 'string' ? body[name] : '');
  const contactName = oneLine(field('contactName'));
  const mailAddress = field('mailAddress').trim();
  const subject = oneLine(field('subject'));
  const message = field('message');
  const token = field('token');
  if (!mailAddress || mailAddress.length > MAX.mailAddress || !EMAIL.test(mailAddress)) {
    return { error: 'A valid email address is required' };
  }
  if (!message.trim()) return { error: 'A message is required' };
  if (message.length > MAX.message) return { error: 'The message is too long' };
  if (subject.length > MAX.subject) return { error: 'The subject is too long' };
  if (contactName.length > MAX.contactName) return { error: 'The name is too long' };
  if (!token) return { error: 'Verification is required' };
  return {
    contactName,
    mailAddress,
    subject: subject || 'Message from the Reactome website',
    message,
    token,
  };
}

function mountContactRoute(
  app,
  {
    route = '/contact',
    verify = (token, remoteip) => gate.verifyCaptcha(token, fetch, remoteip),
    send = sendmail,
    env = process.env,
  } = {}
) {
  app.get(route, (_req, res) => {
    if (!canSend(env)) {
      res.status(503).json({ detail: 'Messages cannot be sent from this deployment' });
      return;
    }
    res.json({ sitekey: gate.TURNSTILE_SITEKEY });
  });

  app.post(route, express.json({ limit: '16kb' }), async (req, res) => {
    if (!canSend(env)) {
      res.status(503).json({ detail: 'Messages cannot be sent from this deployment' });
      return;
    }
    const read = readMessage(req.body);
    if (read.error) {
      res.status(400).json({ detail: read.error });
      return;
    }
    const key = clientKey(req);
    const wait = contactLimiter.wait(key);
    if (wait) {
      res.set('Retry-After', String(wait)).status(429).json({ detail: 'Too many messages' });
      return;
    }
    // Counted once checked: a refused token spends only its sender's budget,
    // so unverified calls cannot use up the total and close the form for all.
    const verified = await verify(read.token, key);
    contactLimiter.record(key, { global: verified });
    if (!verified) {
      res.status(403).json({ detail: 'Verification failed' });
      return;
    }
    const { to, from } = settings(env);
    try {
      await send(compose({ ...read, to, from }), from);
    } catch (error) {
      console.error('Contact message could not be handed to the MTA', error);
      res.status(502).json({ detail: 'The message could not be sent' });
      return;
    }
    res.json({ sent: true });
  });
}

module.exports = {
  mountContactRoute,
  compose,
  readMessage,
  sendmail,
  // Test-only: the counters are process-wide, so a spec needs to start clean.
  __resetLimits: () => contactLimiter.reset(),
};
