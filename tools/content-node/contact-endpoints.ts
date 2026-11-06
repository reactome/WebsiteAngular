/**
 * The contact endpoint (spec 006 T085, research D23): POST /contact,
 * ContactController's -- a message to the help desk. Not the copy to the
 * reader Java sent when asked: `sendEmailCopy` is still taken, and ignored
 * (research D23).
 *
 * Java's parameters, read as Tomcat reads them -- from the query and from a
 * form body, URL-encoded or multipart -- and Java's answers where Java
 * decides them, but for its human check: Java asked hCaptcha, through a
 * client that trusted any certificate; this asks Cloudflare Turnstile, as the
 * rest of the site does, so its token comes as `cf-turnstile-response`, the
 * field Turnstile's widget adds to a form. What Java never answered is
 * answered in its envelope: 503 when this deployment cannot send, 400 for an
 * address that is not one address, and 500, without SES's words, when
 * the mail could not be handed on.
 */
import type { Answer, Endpoint, Request } from './endpoint.ts';
import { javaError } from './answers.ts';
import { requiredString, servletParameter } from './spring.ts';
import { settings } from './settings.ts';
import { turnstileVerified } from './turnstile.ts';
import type { MailSettings, Sender } from './contact.ts';
import {
  contactMail,
  javaBlank,
  mailSettings,
  sendEmailInput,
  singleAddress,
  sesSender,
} from './contact.ts';

/** The field Turnstile's widget adds to a form, in place of Java's `h-captcha-response`. */
export const TOKEN_PARAMETER = 'cf-turnstile-response';

/** What the handler needs from outside, replaced in its specs. */
export interface ContactDependencies {
  verify: (token: string) => Promise<boolean>;
  sender: (mail: MailSettings) => Sender;
}

const DEPENDENCIES: ContactDependencies = {
  verify: (token) => turnstileVerified(token),
  sender: (mail) => sesSender(mail),
};

/**
 * A request's parameters as the servlet has them: the query's first, then a
 * form body's. Tomcat reads a body for parameters only when it is
 * application/x-www-form-urlencoded, and Spring's multipart resolver one that
 * is multipart/form-data; any other body is not read. A multipart body that
 * cannot be parsed gives no parameters.
 */
async function parametersOf(request: Request): Promise<(name: string) => string[]> {
  const url = String(request.originalUrl ?? '');
  const at = url.indexOf('?');
  const query = at === -1 ? '' : url.slice(at + 1);
  const type = request.get?.('content-type') ?? '';
  const media = (type.split(';')[0] ?? '').trim().toLowerCase();
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  let fromBody: (name: string) => string[] = () => [];
  if (media === 'application/x-www-form-urlencoded') {
    const text = body.toString('utf8');
    fromBody = (name) => servletParameter(text, name);
  } else if (media === 'multipart/form-data') {
    try {
      const form = await new Response(new Uint8Array(body), {
        headers: { 'content-type': type },
      }).formData();
      fromBody = (name) =>
        form.getAll(name).filter((value): value is string => typeof value === 'string');
    } catch {
      fromBody = () => [];
    }
  }
  return (name) => [...servletParameter(query, name), ...fromBody(name)];
}

/** Java's 400 text for a check that failed, as the controller writes it. */
const textAnswer = (status: number, body: string): Answer => ({
  status,
  type: 'text/plain;charset=UTF-8',
  body,
});

/** ContactController.contact, with Turnstile for the human check. */
export async function contactAnswer(
  request: Request,
  dependencies: ContactDependencies = DEPENDENCIES
): Promise<Answer> {
  if (request.tooLarge)
    return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'The message is too large');
  const parameters = await parametersOf(request);
  // Spring binds the method's parameters in order, and the first missing
  // required one is the 400. Several values of one are joined by commas.
  const values: Record<string, string> = {};
  for (const [name, required] of [
    ['contactName', false],
    ['mailAddress', true],
    ['subject', true],
    ['message', true],
    ['sendEmailCopy', false],
    [TOKEN_PARAMETER, true],
  ] as const) {
    const given = parameters(name);
    if (given.length === 0 && required)
      return javaError(request, 400, 'BAD_REQUEST', requiredString(name));
    values[name] = given.join(',');
  }
  const field = (name: string) => values[name] ?? '';

  // Nothing is checked with Cloudflare, or sent, by a deployment that could
  // not send it: no support address or SES region, or no Turnstile secret.
  const mail = mailSettings();
  if (!mail || !settings.turnstileSecret())
    return javaError(
      request,
      503,
      'SERVICE_UNAVAILABLE',
      'Messages cannot be sent from this deployment'
    );

  if (javaBlank(field(TOKEN_PARAMETER)) || !(await dependencies.verify(field(TOKEN_PARAMETER))))
    return textAnswer(400, 'captcha verification failed');
  const form = {
    contactName: field('contactName'),
    mailAddress: field('mailAddress'),
    subject: field('subject'),
    message: field('message'),
  };
  if (javaBlank(form.mailAddress) || javaBlank(form.subject) || javaBlank(form.message))
    return textAnswer(400, 'missing required field');
  if (!singleAddress(form.mailAddress))
    return javaError(request, 400, 'BAD_REQUEST', 'mailAddress is not one email address');

  // sendEmailCopy was bound above, as Java declares it, and goes no further:
  // nothing is sent to an address the reader typed (research D23).
  const sender = dependencies.sender(mail);
  try {
    await sender(sendEmailInput(contactMail(form, mail)));
  } catch (failure) {
    // The error's name and HTTP status alone: its message can carry the
    // addresses, and a credentials failure's the role's details.
    const { name, $metadata } = (failure ?? {}) as {
      name?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    const status = $metadata?.httpStatusCode;
    console.error(
      `contact: the message could not be sent (${String(name ?? 'unknown')}${status === undefined ? '' : ` ${String(status)}`})`
    );
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', 'The message could not be sent');
  }
  return { status: 200 };
}

export const contactEndpoints: Endpoint[] = [
  {
    path: '/ContentService/contact',
    method: 'post',
    // No sample body: the parity harness sends a POST as text/plain, which
    // neither side reads for parameters, so both answer the missing
    // mailAddress and nothing is sent. A request Java accepts sends mail,
    // so none is ever sent to Java; its refusals before sending are recorded
    // in contact.spec.ts.
    handler: (request) => contactAnswer(request),
  },
];
