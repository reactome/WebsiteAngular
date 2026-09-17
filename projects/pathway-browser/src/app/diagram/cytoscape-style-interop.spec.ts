/**
 * `reactome-cytoscape-style` can be imported under vitest.
 *
 * Its published ESM does `import { isArray } from 'lodash'`, and lodash is
 * CommonJS only. Vite's interop rejects that named import -- "Named export
 * 'isArray' not found" -- before any test using the library can run.
 * `server.deps.inline` in vitest.config.ts makes vite transform the library and
 * resolve the interop, which is why that option is there.
 *
 * Nothing exercised it. Every module importing this library is a component, and
 * the same config file explains that components are covered by e2e rather than
 * unit tests -- so the option was load-bearing and untested, and a vitest or vite
 * upgrade could have silently stopped honouring it. Found while moving to
 * vitest 4 (#234), where it would have been exactly the kind of breakage a
 * "244 passed" run does not mention.
 *
 * The import is the test. The assertions are here so it fails as a statement
 * about the library rather than as a bare module error.
 */
import { describe, expect, it } from 'vitest';
import { ReactomeEventTypes, Style } from 'reactome-cytoscape-style';

describe('the cytoscape style library under vitest', () => {
  it('imports, despite its lodash interop', () => {
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
