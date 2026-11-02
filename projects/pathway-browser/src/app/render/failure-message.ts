/**
 * A failed request's message, fit for the render service's answer.
 *
 * The message names the URL it asked, and the host in it is the address the
 * render service reaches the site on, which the service's answer would pass
 * on: the path is kept, the host is not. Nor an analysis token, which a failed
 * request carries in its query (the overview's tree) or its path (the analysis
 * service's own).
 */
export function failureMessage(message: string): string {
  return message
    .replace(/\bhttps?:\/\/[^/\s]+/g, '')
    .replace(/([?&;](?:token|analysis)=)[^&;:\s]+/gi, '$1…')
    .replace(/(\/token\/)[^/?;:\s]+/gi, '$1…');
}
