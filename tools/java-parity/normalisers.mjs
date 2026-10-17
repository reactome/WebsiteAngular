/**
 * The normalisers parity may apply, each declared here with what it removes
 * and why. A difference is only ever hidden by one of these, by name, in the
 * run that uses it -- never by loosening the comparison itself.
 */
import { gunzipSync } from 'node:zlib';

/** Drop `summary.token`: an analysis token holds the time and a per-process counter, so two runs never share one. */
function withoutToken(text) {
  const value = JSON.parse(text);
  if (value?.summary && typeof value.summary === 'object') delete value.summary.token;
  return JSON.stringify(value);
}

export const normalisers = {
  /** Byte for byte. */
  identity: (body) => body,
  /** An analysis result (JSON) without its token. */
  analysisResult: (body) => Buffer.from(withoutToken(body.toString('utf8'))),
  /** The gzipped result download, decompressed, without its token. */
  analysisResultGz: (body) => Buffer.from(withoutToken(gunzipSync(body).toString('utf8'))),
};
