/**
 * The help-desk message of POST /contact (spec 006 T085): who it goes to,
 * what it says, and the SMTP connection that carries it. ContactController
 * and MailService's, with Java's mail settings read from the environment
 * (settings.ts).
 *
 * Two messages at most, as Java sends them: the reader's to the support
 * address, from the reader, and -- asked for -- a copy to the reader, from
 * the support address, its subject "[Copy] " and the subject. Both bodies are
 * "From: name <address>", a blank line, and the message.
 *
 * The connection is not Java's in one respect, deliberately (research D23):
 * the server's certificate is verified -- against the system's certificate
 * authorities, its name checked -- and TLS is required, by STARTTLS or from
 * the first byte on port 465. Nothing here turns either off: a server that
 * cannot prove who it is is not given the message, or the login.
 */
import nodemailer from 'nodemailer';
import type { SendMailOptions, SMTPTransportOptions } from 'nodemailer';
import type { ConnectionOptions } from 'node:tls';
import { settings } from './settings.ts';

/** Where and how mail is sent, or why it cannot be. */
export interface MailSettings {
  host: string;
  port: number;
  /** A login, when the server asks for one (mail.enable.auth). */
  auth?: { user: string; pass: string };
  supportAddress: string;
  supportName: string;
}

/**
 * The mail settings, or undefined when they are not enough to send: no
 * server, no support address, a port that is no port, or a login asked for
 * and not given. Read per request, as the rest of settings.ts is.
 */
export function mailSettings(): MailSettings | undefined {
  const host = settings.contactSmtpHost().trim();
  const supportAddress = settings.contactSupportAddress().trim();
  const port = Number(settings.contactSmtpPort().trim());
  if (!host || !singleAddress(supportAddress)) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const supportName = settings.contactSupportName().trim();
  if (settings.contactSmtpAuth().trim().toLowerCase() !== 'true')
    return { host, port, supportAddress, supportName };
  const user = settings.contactSmtpUser();
  const pass = settings.contactSmtpPassword();
  if (!user || !pass) return undefined;
  return { host, port, auth: { user, pass }, supportAddress, supportName };
}

/**
 * The connection's options. TLS always: from the first byte on 465, else by
 * STARTTLS, which is required -- a server that does not offer it, or a
 * connection whose offer was stripped on the way, is refused rather than
 * sent the message in clear. The certificate is checked against the
 * system's authorities and the host's name; `ca` replaces those
 * authorities, for tests only (an internal authority is added to the
 * system's with NODE_EXTRA_CA_CERTS).
 */
export function transportOptions(
  mail: MailSettings,
  ca?: ConnectionOptions['ca']
): SMTPTransportOptions {
  const tls: ConnectionOptions = {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(ca === undefined ? {} : { ca }),
  };
  const secure = mail.port === 465;
  return {
    host: mail.host,
    port: mail.port,
    secure,
    requireTLS: !secure,
    tls,
    ...(mail.auth ? { auth: mail.auth } : {}),
    // A server that does not answer must not hold the request for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

/** One message, as MailService.start takes it. */
export interface Mail {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  body: string;
}

/**
 * One plain address, user@domain, and nothing an address parser could read
 * as more than one, or as a name: MailService's `new InternetAddress(..)`
 * refused anything but one address, and the copy goes to the address the
 * reader gives, so this is what stops one request mailing a list.
 */
export function singleAddress(text: string): boolean {
  // Printable ASCII only -- no space, no control character -- as an
  // InternetAddress without UTF-8 allowed takes it.
  if (text.length > 254 || !/^[!-~]+$/.test(text)) return false;
  return /^[^@<>,;:"()[\]\\]+@[^@<>,;:"()[\]\\]+$/.test(text);
}

/**
 * Character.isWhitespace's code points: the Unicode space, line and paragraph
 * separators but the no-break spaces (U+00A0, U+2007, U+202F), and tab, line
 * feed, U+000B, form feed, carriage return and U+001C to U+001F.
 */
const JAVA_WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x205f, 0x3000,
]);

/** Apache's StringUtils.isBlank: empty, or nothing but Character.isWhitespace. */
export function javaBlank(text: string): boolean {
  for (const char of text) if (!JAVA_WHITESPACE.has(char.codePointAt(0) as number)) return false;
  return true;
}

/**
 * ContactController's messages for one form: the reader's to the support
 * address and, asked for, the copy back to the reader.
 */
export function contactMails(
  form: { contactName: string; mailAddress: string; subject: string; message: string },
  copy: boolean,
  mail: MailSettings
): Mail[] {
  const fromName = javaBlank(form.contactName) ? form.mailAddress : form.contactName;
  // String.format's %n is the platform's line separator: a newline on Linux.
  const body = `From: ${fromName} <${form.mailAddress}>\n\n${form.message}`;
  const mails: Mail[] = [
    {
      fromName,
      fromAddress: form.mailAddress,
      to: mail.supportAddress,
      subject: form.subject,
      body,
    },
  ];
  if (copy)
    mails.push({
      fromName: mail.supportName,
      fromAddress: mail.supportAddress,
      to: form.mailAddress,
      subject: `[Copy] ${form.subject}`,
      body,
    });
  return mails;
}

/** Something that sends a message, as nodemailer's transports do. */
export interface Sender {
  sendMail(message: SendMailOptions): Promise<unknown>;
}

/** An SMTP transport for these settings. */
export function smtpSender(mail: MailSettings, ca?: ConnectionOptions['ca']): Sender {
  return nodemailer.createTransport(transportOptions(mail, ca));
}

/**
 * Sends one message, as MailService.start does: plain text, From the name
 * and address (the address alone when the name is blank), To one address.
 * Addresses go in as objects, never as text to be parsed, and the name and
 * subject are encoded by the library, so a line break in either is no new
 * header.
 */
export async function sendOne(sender: Sender, mail: Mail) {
  await sender.sendMail({
    from: javaBlank(mail.fromName)
      ? mail.fromAddress
      : { name: mail.fromName, address: mail.fromAddress },
    to: mail.to,
    subject: mail.subject,
    text: mail.body,
    // No X-Mailer naming the library and its version.
    xMailer: false,
  });
}
