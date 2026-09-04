/**
 * Legacy pathway links in the URL fragment.
 *
 * The old browser addressed a pathway in the fragment, and this site's own news
 * archive is full of those links: 770 spelled `#/R-HSA-1430728` and 86 spelled
 * `#R-HSA-202733`, with no slash. The pattern used to require the slash, so the
 * second kind matched nothing and opened the browser with no pathway in it.
 *
 * The cases below are taken from what is actually in the content, not invented.
 */
import { describe, expect, it } from 'vitest';
import { FRAGMENT_PATTERN } from './url-state.service';

/** What the subscriber does with a fragment, reduced to its decisions. */
function route(fragment: string) {
  const match = fragment.match(FRAGMENT_PATTERN);
  if (!match?.groups) return { id: undefined, params: {} as Record<string, unknown> };
  const params: Record<string, unknown> = {};
  if (match.groups['params']) {
    for (const [key, value] of match.groups['params'].split('&').map((p) => p.split('='))) {
      params[key] = value || true;
    }
  }
  return { id: match.groups['id'], params };
}

describe('a legacy pathway link in the fragment', () => {
  it('opens the pathway when the link carries a slash', () => {
    expect(route('/R-HSA-1430728').id).toBe('R-HSA-1430728');
  });

  it('opens the pathway when the link carries no slash', () => {
    // 41 links in the news archive look like this, and every one of them used
    // to land on an empty browser.
    expect(route('R-HSA-202733').id).toBe('R-HSA-202733');
    expect(route('R-HSA-913531').id).toBe('R-HSA-913531');
  });

  it('drops a stIdVersion rather than passing it on as a parameter', () => {
    // 45 links carry one. It used to arrive as a query parameter named ".1".
    for (const fragment of ['R-HSA-8853659.1', '/R-HSA-69231.4', 'R-HSA-3371497.12']) {
      const { id, params } = route(fragment);
      expect(id, fragment).toMatch(/^R-[A-Z]{3}-\d+$/);
      expect(Object.keys(params), fragment).toEqual([]);
    }
  });

  it('keeps the parameters an old link carries', () => {
    const { id, params } = route('/R-HSA-8876384&PATH=R-HSA-1643685,R-HSA-5663205');
    expect(id).toBe('R-HSA-8876384');
    expect(params).toEqual({ PATH: 'R-HSA-1643685,R-HSA-5663205' });
  });

  it('leaves a fragment that is not a pathway alone', () => {
    // A section to scroll to, and the old analysis-tool fragment. Matching
    // these would turn them into a route to nowhere and a junk query
    // parameter; they have to fall through untouched.
    for (const fragment of ['introduction', 'summation', 'TOOL=AT', 'literature']) {
      expect(route(fragment).id, fragment).toBeUndefined();
      expect(Object.keys(route(fragment).params), fragment).toEqual([]);
    }
  });

  it('does not take an identifier out of the middle of something else', () => {
    for (const fragment of ['see-R-HSA-202733-here', 'XR-HSA-202733']) {
      expect(route(fragment).id, fragment).toBeUndefined();
    }
  });
});
