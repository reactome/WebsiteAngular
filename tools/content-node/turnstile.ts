/**
 * Cloudflare Turnstile's server-side check, as the site's own gate makes it
 * (projects/website-angular/src/scripts/human-gate.js, verifyCaptcha): the
 * same secret, the same siteverify, the same rule that anything but a clear
 * yes is a no. A twin rather than an import: the content service's image
 * carries tools/content-node alone, and that module reads its settings once,
 * at load, where this service reads them per request.
 *
 * The address Cloudflare is asked at is verified as any HTTPS address is:
 * against the system's certificate authorities, by name.
 */
import { settings } from './settings.ts';

/** How long Cloudflare has to answer before the check counts as failed. */
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Whether Turnstile vouches for a response token. No secret, no token, a
 * network failure, a slow or non-200 answer, or one that is not exactly
 * `success: true`: false, never a pass by accident.
 */
export async function turnstileVerified(token: string, fetchImpl: typeof fetch = fetch) {
  const secret = settings.turnstileSecret();
  if (!secret || token === '') return false;
  try {
    const response = await fetchImpl(settings.turnstileVerifyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const body = (await response.json()) as { success?: unknown } | null;
    return body?.success === true;
  } catch {
    return false;
  }
}
