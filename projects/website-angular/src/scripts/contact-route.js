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

/** RFC 2047, for a subject that is not plain ASCII. */
function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** The whole message, headers and body, as the MTA reads it. */
function compose({ to, from, contactName, mailAddress, subject, message, site }) {
  return [
    `From: Reactome website <${from}>`,
    `To: ${to}`,
    `Reply-To: ${mailAddress}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.replace(/\r\n?/g, '\n'),
    '',
    '--',
    `Sent from the search page of ${site} by ${contactName ? `${contactName} <${mailAddress}>` : mailAddress}.`,
    '',
  ].join('\n');
}

/**
 * Hands a composed message to sendmail. `-t` takes the recipients from the
 * headers, `-i` keeps a line of a lone "." from ending the message early.
 */
function sendmail(raw, from, sendmailPath = '/usr/sbin/sendmail') {
  return new Promise((resolve, reject) => {
    const child = spawn(sendmailPath, ['-t', '-i', '-f', from], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`sendmail exited ${code}: ${stderr.trim()}`))
    );
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
  { route = '/contact', verify = gate.verifyCaptcha, send = sendmail, env = process.env } = {}
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
    const wait = contactLimiter.retryAfter(clientKey(req));
    if (wait) {
      res.set('Retry-After', String(wait)).status(429).json({ detail: 'Too many messages' });
      return;
    }
    if (!(await verify(read.token))) {
      res.status(403).json({ detail: 'Verification failed' });
      return;
    }
    const { to, from } = settings(env);
    try {
      await send(
        compose({ ...read, to, from, site: oneLine(req.headers.host || 'reactome.org') }),
        from
      );
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
