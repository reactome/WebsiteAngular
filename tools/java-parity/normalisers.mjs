/**
 * The normalisers parity may apply, each declared here with what it removes
 * and why. A difference is only ever hidden by one of these, by name, in the
 * run that uses it -- never by loosening the comparison itself.
 *
 * Each removes exactly its target's bytes and leaves every other byte as it
 * came. A JSON parse-and-print round trip would not: it loses digits past
 * 2^53, folds -0 into 0, drops duplicate keys, reorders integer-like keys and
 * rewrites number formats and escapes -- differences the API's R and Python
 * users would see, hidden from the comparison.
 */
import { gunzipSync } from 'node:zlib';

/**
 * An analysis token holds the time and a per-process counter, so two runs
 * never share one: its value -- only its value -- is blanked inside
 * `summary`.
 */
function withoutToken(bytes) {
  // latin1 maps bytes to code units one to one, so nothing else is re-encoded.
  const text = bytes.toString('latin1');
  return Buffer.from(
    text.replace(/("summary"\s*:\s*\{[^{}]*?"token"\s*:\s*)"(?:[^"\\]|\\.)*"/, '$1""'),
    'latin1'
  );
}

export const normalisers = {
  /** Byte for byte. */
  identity: (body) => body,
  /** An analysis result (JSON) with its token blanked. */
  analysisResult: (body) => withoutToken(body),
  /** The gzipped result download, decompressed, with its token blanked. Not gzip: an error. */
  analysisResultGz: (body) => withoutToken(gunzipSync(body)),
};
