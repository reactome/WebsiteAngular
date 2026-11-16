/**
 * `ngx-reactome-cytoscape-style` can be imported under vitest.
 *
 * It used to import lodash, which is CommonJS only, and vite's interop rejected
 * the named import ("Named export 'isArray' not found") until vitest.config.ts
 * inlined the library. The library no longer imports lodash
 * (reactome/ngx-reactome-base#15), so that option is gone. This keeps the import
 * under test, so a library build that brings back a CommonJS-only import fails
 * here, as a statement about the library, rather than in whichever spec happens
 * to pull it in first.
 */
import { describe, expect, it } from 'vitest';
import { ReactomeEventTypes, Style } from 'ngx-reactome-cytoscape-style';

describe('the cytoscape style library under vitest', () => {
  it('imports under vitest as it is installed', () => {
    expect(typeof Style, 'Style should be the class the diagram builds on').toBe('function');
  });

  it('carries the events the diagram listens for', () => {
    // The names the pathway browser subscribes to, namespaced by the library.
    // Pinned to the real values rather than the bare words -- I guessed 'select'
    // first and the test failed, which is the argument for pinning them.
    expect(Object.values(ReactomeEventTypes)).toEqual(
      expect.arrayContaining([
        'reactome::select',
        'reactome::unselect',
        'reactome::hover',
        'reactome::leave',
        'reactome::open',
        'reactome::close',
      ])
    );
  });
});
