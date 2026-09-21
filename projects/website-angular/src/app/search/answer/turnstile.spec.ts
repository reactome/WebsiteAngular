/**
 * What happens to the widget when the exchange behind it is refused.
 *
 * A Turnstile token is single-use, so a refused exchange leaves a widget that
 * can never succeed. Both panels render theirs from an effect that reads the
 * challenge signal, and a refusal leaves that signal untouched -- so whatever
 * recovers the widget has to do it without anything re-running.
 *
 * These exist because the previous two attempts at this were comments. One said
 * the service returned a boolean "so the panel can render a fresh widget" and
 * both panels discarded it; the next emptied the host and said that "is what
 * lets a fresh one appear", which nothing did.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderChallenge } from './turnstile';

/**
 * A stand-in for Cloudflare's script that behaves like the real one in the two
 * ways these tests turn on: `render` puts a child in the host and hands back an
 * id, and the solve callback is ours to fire when we choose.
 */
function stubTurnstile(options: { resetThrows?: boolean } = {}) {
  let solve: ((token: string) => void) | undefined;
  const reset = vi.fn(() => {
    if (options.resetThrows) throw new TypeError('turnstile.reset is not a function');
  });
  const render = vi.fn((el: HTMLElement, opts: { callback: (token: string) => void }) => {
    el.appendChild(document.createElement('iframe'));
    solve = opts.callback;
    return `widget-${render.mock.calls.length}`;
  });
  (window as unknown as { turnstile: unknown }).turnstile = { render, reset };
  return { render, reset, solveWith: (token: string) => solve?.(token) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a challenge whose exchange is refused', () => {
  it('re-arms the widget in place rather than leaving an empty box', async () => {
    const host = document.createElement('div');
    const stub = stubTurnstile();
    await renderChallenge(host, 'sitekey', () => Promise.resolve(false));

    stub.solveWith('a-spent-token');
    await settle();

    expect(stub.reset).toHaveBeenCalledWith('widget-1');
    // The point of the whole thing: something is still on screen to solve.
    expect(host.childElementCount).toBe(1);
  });

  it('renders a fresh one when the script is too old to reset', async () => {
    const host = document.createElement('div');
    const stub = stubTurnstile({ resetThrows: true });
    await renderChallenge(host, 'sitekey', () => Promise.resolve(false));

    stub.solveWith('a-spent-token');
    await settle();

    expect(stub.render).toHaveBeenCalledTimes(2);
    // One widget, not two stacked: the host is emptied before the second.
    expect(host.childElementCount).toBe(1);
  });
});

describe('a challenge whose exchange is accepted', () => {
  it('leaves the widget alone, because the panel is about to replace it', async () => {
    const host = document.createElement('div');
    const stub = stubTurnstile();
    await renderChallenge(host, 'sitekey', () => Promise.resolve(true));

    stub.solveWith('a-good-token');
    await settle();

    expect(stub.reset).not.toHaveBeenCalled();
    expect(stub.render).toHaveBeenCalledTimes(1);
  });
});
