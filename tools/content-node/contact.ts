/**
 * The help-desk message of POST /contact (spec 006 T085): who it goes to,
 * what it says, and how it is sent. ContactController's, with the support
 * address and name read from the environment (settings.ts).
 *
 * One message: the reader's, to the support address. Not Java's shape, by
 * awright's decision (research D23): it is from the support address, with
 * the reader as its Reply-To, where Java wrote it from the reader's own
 * address -- which receiving servers' checks (SPF, DMARC) refuse or file as
 * spam -- and no copy goes back to the reader, where Java sent one to
 * whatever address was typed. The body is still Java's: "From: name
 * <address>", a blank line, and the message, so the help desk sees who
 * wrote.
 *
 * Sent through Amazon SES's API (SendEmail, v2), not SMTP (research D23):
 * signed with the credentials the AWS SDK's default chain finds -- on the
 * host, the instance's role -- so no password is stored anywhere, over HTTPS
 * the SDK verifies as it verifies any, against the system's authorities and
 * the endpoint's name.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SESv2ClientConfig, SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { settings } from './settings.ts';

/** Where mail goes, and through which SES region. */
export interface MailSettings {
  supportAddress: string;
  supportName: string;
  region: string;
}

/** An AWS region's name: us-east-1, eu-west-2, ap-southeast-1 and the like. */
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

/**
 * The mail settings, or undefined when they are not enough to send: no
 * support address (or one that is not one address), or a region that is no
 * region. Read per request, as the rest of settings.ts is.
 */
export function mailSettings(): MailSettings | undefined {
  const supportAddress = settings.contactSupportAddress().trim();
  const region = settings.contactSesRegion().trim();
  if (!singleAddress(supportAddress) || !REGION.test(region)) return undefined;
  return { supportAddress, supportName: settings.contactSupportName().trim(), region };
}

/** How long the attempt may take, connecting and answering. */
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** The whole send: the reader's request is never held longer. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * The SES client's configuration: the region, one attempt and no retry --
 * an answer that comes late may still have been sent, and a retry would send
 * the message twice -- and its timeouts. Credentials are left to the SDK's default chain
 * (the instance's role on the host); no agent is given, so HTTPS is verified
 * by Node's defaults.
 */
export function clientConfig(region: string): SESv2ClientConfig {
  return {
    region,
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    },
  };
}

/** One client per region, kept: its credentials are cached between messages. */
const clients = new Map<string, SESv2Client>();
export function sesClient(region: string): SESv2Client {
  let client = clients.get(region);
  if (!client) {
    client = new SESv2Client(clientConfig(region));
    clients.set(region, client);
  }
  return client;
}

/** An address as a message names it. */
export interface Address {
  name: string;
  address: string;
}

/** The one message a form sends. */
export interface Mail {
  from: Address;
  replyTo: Address;
  to: Address;
  subject: string;
  body: string;
}

/** An atom of a dot-atom local part, without `%` and `!` (source routing of old). */
const ATOM = "[A-Za-z0-9#$&'*+/=?^_`{|}~-]+";
/** A domain's label: letters, digits and hyphens, a hyphen at neither end. */
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const ADDRESS = new RegExp(`^(${ATOM}(?:\\.${ATOM})*)@${LABEL}(?:\\.${LABEL})+$`);

/**
 * One plain address, user@domain, and nothing an address parser could read
 * as more than one, or as a name. Nothing is sent to the reader's address,
 * but it is the message's Reply-To: a reply from the help desk goes to it,
 * so a list typed there would be answered as a list. And MailService's `new
 * InternetAddress(..)` refused anything but one address, so this keeps that
 * refusal (a 400 here, Java's 500). The support address is held to it too.
 *
 * The local part is a dot-atom -- no dot leading, trailing or doubled --
 * without `%` or `!`, and not starting `=?`, which a reader could take for an
 * encoded word; the domain is two or more labels of letters, digits and
 * hyphens. Printable ASCII only, as an InternetAddress without UTF-8 allowed
 * takes it.
 */
export function singleAddress(text: string): boolean {
  if (text.length > 254) return false;
  const local = ADDRESS.exec(text)?.[1];
  return local !== undefined && local.length <= 64 && !local.startsWith('=?');
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
 * Text for one header line: a control character (C0, DEL, C1's next line)
 * or a Unicode line or paragraph separator becomes a space, so nothing a
 * reader types can end the line or start another.
 */
export function oneLine(text: string): string {
  let line = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const breaks =
      code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029;
    line += breaks ? ' ' : char;
  }
  return line;
}

/** The most UTF-8 one encoded word carries: 45 bytes, 60 of base64, 75 in all. */
const WORD_BYTES = 45;

/**
 * A name as RFC 2047 encoded words, B encoding of its UTF-8: each at most 75
 * characters, split between characters, never inside one, separated by
 * spaces.
 */
export function encodedWords(name: string): string {
  const words: string[] = [];
  let chunk: number[] = [];
  for (const char of name) {
    const bytes = [...Buffer.from(char, 'utf8')];
    if (chunk.length + bytes.length > WORD_BYTES) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
  return words.join(' ');
}

/**
 * An address as a header writes it, from text SES takes as given: the
 * address alone when there is no name; the name made one line (oneLine),
 * then, of printable ASCII, an RFC 5322 quoted string, its quotes and
 * backslashes escaped, or else RFC 2047 encoded words (encodedWords). Either
 * way the name cannot end the header or start another.
 */
export function mailbox({ name, address }: Address): string {
  const line = oneLine(name);
  if (javaBlank(line)) return address;
  const written = /^[ -~]*$/.test(line)
    ? `"${line.replace(/["\\]/g, (char) => `\\${char}`)}"`
    : encodedWords(line);
  return `${written} <${address}>`;
}

/**
 * The message for one form: from the support address, to it, Reply-To the
 * reader -- named when a name was given -- and Java's body. `sendEmailCopy`
 * plays no part: no copy is sent (research D23).
 */
export function contactMail(
  form: { contactName: string; mailAddress: string; subject: string; message: string },
  mail: MailSettings
): Mail {
  const named = !javaBlank(form.contactName);
  const fromName = named ? form.contactName : form.mailAddress;
  const support = { name: mail.supportName, address: mail.supportAddress };
  return {
    from: support,
    replyTo: { name: named ? form.contactName : '', address: form.mailAddress },
    to: support,
    subject: form.subject,
    // String.format's %n is the platform's line separator: a newline on Linux.
    body: `From: ${fromName} <${form.mailAddress}>\n\n${form.message}`,
  };
}

/**
 * SendEmail's input for the message: a simple message, its subject and text
 * in UTF-8, which SES encodes into the headers itself. The subject is made
 * one line (oneLine): none of it can start a header.
 */
export function sendEmailInput(mail: Mail): SendEmailCommandInput {
  return {
    FromEmailAddress: mailbox(mail.from),
    Destination: { ToAddresses: [mailbox(mail.to)] },
    ReplyToAddresses: [mailbox(mail.replyTo)],
    Content: {
      Simple: {
        Subject: { Data: oneLine(mail.subject), Charset: 'UTF-8' },
        Body: { Text: { Data: mail.body, Charset: 'UTF-8' } },
      },
    },
  };
}

/** Sends one SendEmail request; SES's client, or a stand-in in the specs. */
export type Sender = (input: SendEmailCommandInput) => Promise<unknown>;

/** A sender through the region's SES client, never held past SEND_TIMEOUT_MS. */
export function sesSender(mail: MailSettings, client = sesClient(mail.region)): Sender {
  return (input) =>
    client.send(new SendEmailCommand(input), {
      abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
}
