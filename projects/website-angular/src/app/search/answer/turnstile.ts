/**
 * Cloudflare's challenge widget, loaded once and on demand.
 *
 * Module-level rather than per-component so that two panels on one page cannot
 * race to insert the same script — which is why this is shared rather than
 * copied. The search answer and the analysis summary both ask for a challenge,
 * and a reader can have both on screen.
 *
 * The script is fetched only when a challenge is actually asked for: most
 * readers never ask for either feature, and none of them should pay for this
 * just in case. `render=explicit` so it does not hunt the page for containers
 * of its own accord.
 */
interface Turnstile {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void }): string;
}

let turnstileScript: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<void>((resolve, reject) => {
    if ((window as unknown as { turnstile?: unknown }).turnstile) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later attempt rather than caching the failure for ever.
      turnstileScript = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/**
 * Renders a challenge into a host element.
 *
 * Failure is silent by design: no widget means no way to prove anything, and a
 * reader who only wanted a search or a summary should not be handed an error
 * about a third party's script.
 */
export async function renderChallenge(
  host: HTMLElement,
  sitekey: string,
  onSolved: (token: string) => Promise<boolean>
): Promise<void> {
  try {
    await loadTurnstile();
  } catch {
    return;
  }
  const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
  if (!turnstile) return;
  turnstile.render(host, {
    sitekey,
    callback: (token: string) => {
      void onSolved(token).then((accepted) => {
        // A token is single-use, so a refused exchange leaves a widget that can
        // never succeed -- and the caller's re-render guard ("this host already
        // has a child") then keeps it there. Emptying the host is what lets a
        // fresh one appear.
        //
        // Both panels used to discard this result while the service's own
        // comment said it was returned "so the panel can render a fresh widget
        // rather than leaving the reader looking at a spent one". The intent
        // was written down and never implemented.
        if (!accepted) host.replaceChildren();
      });
    },
  });
}
